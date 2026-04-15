"""
VibeVoice AI Audio Engine — Core Engine
────────────────────────────────────────
Hardware-aware model loading and inference.  Supports:
  • Zero-shot voice cloning (fingerprint extraction + diffusion synthesis)
  • Streaming TTS via AsyncAudioStreamer
  • Voice presets (20+ built-in voices across 12 languages)

Adapts automatically:
  LOW tier  → Realtime-0.5B in NF4 4-bit
  HIGH tier → 1.5B BF16 + torch.compile
"""

import os
import io
import torch
import numpy as np
import soundfile as sf
import librosa
import asyncio
import urllib.request
from copy import deepcopy
from typing import AsyncGenerator, Optional

from hardware import HardwareProfile, get_bnb_config


# ─── Voice Presets ─────────────────────────────────────────────────────────────

VOICE_PRESETS = {
    # German
    "German 1 (Male)":   {"filename": "de-Spk0_man.pt",    "gender": "male",   "lang": "de"},
    "German 2 (Female)": {"filename": "de-Spk1_woman.pt",  "gender": "female", "lang": "de"},
    # English
    "Carter (US Male)":  {"filename": "en-Carter_man.pt",   "gender": "male",   "lang": "en"},
    "Davis (US Male)":   {"filename": "en-Davis_man.pt",    "gender": "male",   "lang": "en"},
    "Emma (US Female)":  {"filename": "en-Emma_woman.pt",   "gender": "female", "lang": "en"},
    "Frank (US Male)":   {"filename": "en-Frank_man.pt",    "gender": "male",   "lang": "en"},
    "Grace (US Female)": {"filename": "en-Grace_woman.pt",  "gender": "female", "lang": "en"},
    "Mike (US Male)":    {"filename": "en-Mike_man.pt",     "gender": "male",   "lang": "en"},
    # French
    "French 1 (Male)":   {"filename": "fr-Spk0_man.pt",    "gender": "male",   "lang": "fr"},
    "French 2 (Female)": {"filename": "fr-Spk1_woman.pt",  "gender": "female", "lang": "fr"},
    # Indian English
    "Samuel (IN Male)":  {"filename": "in-Samuel_man.pt",   "gender": "male",   "lang": "in"},
    # Italian
    "Italian 1 (Female)": {"filename": "it-Spk0_woman.pt", "gender": "female", "lang": "it"},
    "Italian 2 (Male)":   {"filename": "it-Spk1_man.pt",   "gender": "male",   "lang": "it"},
    # Japanese
    "Japanese 1 (Male)":   {"filename": "jp-Spk0_man.pt",  "gender": "male",   "lang": "jp"},
    "Japanese 2 (Female)": {"filename": "jp-Spk1_woman.pt","gender": "female", "lang": "jp"},
    # Korean
    "Korean 1 (Female)": {"filename": "kr-Spk0_woman.pt",  "gender": "female", "lang": "kr"},
    "Korean 2 (Male)":   {"filename": "kr-Spk1_man.pt",    "gender": "male",   "lang": "kr"},
    # Dutch
    "Dutch 1 (Male)":   {"filename": "nl-Spk0_man.pt",     "gender": "male",   "lang": "nl"},
    "Dutch 2 (Female)": {"filename": "nl-Spk1_woman.pt",   "gender": "female", "lang": "nl"},
    # Polish
    "Polish 1 (Male)":   {"filename": "pl-Spk0_man.pt",    "gender": "male",   "lang": "pl"},
    "Polish 2 (Female)": {"filename": "pl-Spk1_woman.pt",  "gender": "female", "lang": "pl"},
    # Portuguese
    "Portuguese 1 (Female)": {"filename": "pt-Spk0_woman.pt", "gender": "female", "lang": "pt"},
    "Portuguese 2 (Male)":   {"filename": "pt-Spk1_man.pt",   "gender": "male",   "lang": "pt"},
    # Spanish
    "Spanish 1 (Female)": {"filename": "sp-Spk0_woman.pt", "gender": "female", "lang": "sp"},
    "Spanish 2 (Male)":   {"filename": "sp-Spk1_man.pt",   "gender": "male",   "lang": "sp"},
}

PRESET_BASE_URL = "https://raw.githubusercontent.com/microsoft/VibeVoice/main/demo/voices/streaming_model"
PRESET_CACHE_DIR = os.path.join(os.path.dirname(__file__), "voice_presets")


# ─── Engine ────────────────────────────────────────────────────────────────────

class VibeEngine:
    """
    Unified inference engine.  One instance serves all three endpoints
    (cloner, podcast, interviewer).
    """

    def __init__(self, profile: HardwareProfile):
        self.profile = profile
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        # Caches
        self._voice_cache: dict = {}
        self._neg_prompt_cache: Optional[dict] = None

        # Ensure preset dir exists
        os.makedirs(PRESET_CACHE_DIR, exist_ok=True)

        # ── Load Model(s) ──────────────────────────────────────────────────
        self._load_models()

        # ── Load default negative conditioning ─────────────────────────────
        # Initialize smart negatives asynchronously
        asyncio.create_task(self._init_negative_conditioning())

        vram = torch.cuda.memory_allocated() / 1024**3 if torch.cuda.is_available() else 0
        print(f"[Engine] Ready.  VRAM allocated: {vram:.2f} GB")

    # ═══════════════════════════════════════════════════════════════════════════
    # Model Loading
    # ═══════════════════════════════════════════════════════════════════════════

    def _load_models(self):
        """Load 0.5B and/or 1.5B models based on hardware tier."""
        from vibevoice.modular.modeling_vibevoice_streaming_inference import (
            VibeVoiceStreamingForConditionalGenerationInference,
        )
        from vibevoice.processor.vibevoice_streaming_processor import (
            VibeVoiceStreamingProcessor,
        )

        # 1. Load Premium Model (1.5B) if in High Tier or Dual Mode
        if self.profile.tier == "high":
            print(f"[Engine] Loading Premium Model (1.5B): {self.profile.primary_model_id}")
            self.model_large = self._load_single_model(
                self.profile.primary_model_id,
                VibeVoiceStreamingForConditionalGenerationInference
            )
            self.processor_large = VibeVoiceStreamingProcessor.from_pretrained(self.profile.primary_model_id)
        else:
            self.model_large = None
            self.processor_large = None

        # 2. Load Fast Model (0.5B)
        if self.profile.dual_mode or self.profile.tier == "low":
            print(f"[Engine] Loading Fast Model (0.5B): {self.profile.realtime_model_id}")
            self.model_small = self._load_single_model(
                self.profile.realtime_model_id,
                VibeVoiceStreamingForConditionalGenerationInference
            )
            self.processor_small = VibeVoiceStreamingProcessor.from_pretrained(self.profile.realtime_model_id)
        else:
            self.model_small = None
            self.processor_small = None

    def _load_single_model(self, model_id, model_class):
        """Helper to load a single model with correct precision/quantization."""
        if self.profile.quantize == "nf4":
            model = model_class.from_pretrained(
                model_id,
                quantization_config=get_bnb_config(),
                device_map="auto",
            )
        else:
            model = model_class.from_pretrained(
                model_id,
                torch_dtype=self.profile.dtype,
                device_map=self.device,
            )

        if self.profile.quantize is None:
            if self.profile.dtype == torch.bfloat16:
                model.bfloat16()
            else:
                model.half()

        model.eval()
        model.set_ddpm_inference_steps(num_steps=self.profile.ddpm_steps)

        # Noise scheduler
        model.model.noise_scheduler = model.model.noise_scheduler.from_config(
            model.model.noise_scheduler.config,
            algorithm_type="sde-dpmsolver++",
            beta_schedule="squaredcos_cap_v2",
        )

        # Apply torch.compile if requested
        if self.profile.use_compile:
            try:
                model = torch.compile(model, mode="reduce-overhead")
            except Exception as e:
                print(f"[Engine] Compile failed for {model_id}: {e}")

        return model

    # ═══════════════════════════════════════════════════════════════════════════
    # Negative Conditioning
    # ═══════════════════════════════════════════════════════════════════════════

    async def _init_negative_conditioning(self):
        """
        Dynamically extract negative conditioning for loaded models using silence.
        This prevents 'dimension mismatch' errors because the extractor matches the model.
        """
        print("[Engine] Initializing smart negative conditioning...")
        num_samples = int(24000 * 1.0) # 1 second
        silence_np = np.zeros(num_samples, dtype=np.float32)

        if self.model_large:
            self._neg_large = await self._extract_internal_fingerprint(silence_np, self.model_large, "high")
            print("[Engine] 1.5B Negative Conditioning: Initialized")

        if self.model_small:
            self._neg_small = await self._extract_internal_fingerprint(silence_np, self.model_small, "low")
            print("[Engine] 0.5B Negative Conditioning: Initialized")

    async def _extract_internal_fingerprint(self, audio_np: np.ndarray, model, tier: str) -> dict:
        """Internal helper to extract fingerprint from numpy audio for a specific model."""
        dtype = torch.bfloat16 if tier == "high" else torch.float16
        speech_tensor = torch.from_numpy(audio_np).to(device=self.device, dtype=dtype).unsqueeze(0)

        with torch.no_grad():
            acoustic_out = model.acoustic_tokenizer.encode(speech_tensor.unsqueeze(1))
            acoustic_latents = acoustic_out.mean
            acoustic_embeds = model.acoustic_connector(acoustic_latents)

            lm_out = model.forward_lm(inputs_embeds=acoustic_embeds, use_cache=True, return_dict=True)
            speech_mask = torch.zeros((1, acoustic_latents.size(1)), dtype=torch.bool, device=self.device)
            tts_lm_out = model.forward_tts_lm(
                inputs_embeds=acoustic_embeds,
                lm_last_hidden_state=lm_out.last_hidden_state,
                tts_text_masks=speech_mask,
                use_cache=True,
                return_dict=True,
            )

        # Cast outputs to handle the dict-vs-object issue
        return {
            "lm": self._robust_half_explicit(lm_out, dtype),
            "tts_lm": self._robust_half_explicit(tts_lm_out, dtype),
        }

    def _robust_half_explicit(self, obj, target_dtype):
        """Cast tensors while preserving ModelOutput objects."""
        if torch.is_tensor(obj):
            return obj.to(dtype=target_dtype)
        elif isinstance(obj, dict):
            new_data = {k: self._robust_half_explicit(v, target_dtype) for k, v in obj.items()}
            if hasattr(obj, "__class__") and obj.__class__ != dict:
                try: return obj.__class__(new_data)
                except Exception: return new_data
            return new_data
        elif isinstance(obj, (list, tuple)):
            return type(obj)(self._robust_half_explicit(x, target_dtype) for x in obj)
        elif hasattr(obj, "last_hidden_state"):
            if obj.last_hidden_state is not None:
                obj.last_hidden_state = obj.last_hidden_state.to(dtype=target_dtype)
            if hasattr(obj, "past_key_values") and obj.past_key_values is not None:
                pkv = obj.past_key_values
                if hasattr(pkv, "key_cache"):
                    try: obj.past_key_values = tuple(zip(pkv.key_cache, pkv.value_cache))
                    except Exception: pass
                obj.past_key_values = self._robust_half_explicit(obj.past_key_values, target_dtype)
        return obj

    # ═══════════════════════════════════════════════════════════════════════════
    # Negative Conditioning
    # ═══════════════════════════════════════════════════════════════════════════

    def _init_negative_conditioning(self):
        """Load Carter preset as default negative conditioning for CFG."""
        carter_path = self._ensure_preset_file("en-Carter_man.pt")
        carter_data = torch.load(carter_path, map_location=self.device, weights_only=False)

        self._neg_lm     = self._robust_half(carter_data["neg_lm"])
        self._neg_tts_lm = self._robust_half(carter_data["neg_tts_lm"])

    def _robust_half(self, obj):
        """Deprecated: Use _robust_half_explicit with target_dtype for Dual-Engine."""
        return self._robust_half_explicit(obj, self.profile.dtype)

    # ═══════════════════════════════════════════════════════════════════════════
    # Voice Presets
    # ═══════════════════════════════════════════════════════════════════════════

    def _ensure_preset_file(self, filename: str) -> str:
        """Download a voice preset .pt if not already cached locally."""
        local_path = os.path.join(PRESET_CACHE_DIR, filename)
        if not os.path.exists(local_path):
            url = f"{PRESET_BASE_URL}/{filename}"
            print(f"[Engine] Downloading voice preset: {filename}")
            urllib.request.urlretrieve(url, local_path)
        return local_path

    def load_voice_preset(self, speaker_name: str) -> dict:
        """Load a named voice preset and return its prompt dict."""
        if speaker_name in self._voice_cache:
            return deepcopy(self._voice_cache[speaker_name])

        if speaker_name not in VOICE_PRESETS:
            print(f"[Engine] Unknown voice '{speaker_name}', falling back to Carter.")
            speaker_name = "Carter (US Male)"

        filename = VOICE_PRESETS[speaker_name]["filename"]
        local_path = self._ensure_preset_file(filename)
        prompt = torch.load(local_path, map_location=self.device, weights_only=False)
        self._voice_cache[speaker_name] = prompt
        return deepcopy(prompt)

    def get_available_voices(self) -> dict:
        """Return all available voice presets with metadata."""
        return VOICE_PRESETS

    # ═══════════════════════════════════════════════════════════════════════════
    # Zero-Shot Fingerprint Extraction
    # ═══════════════════════════════════════════════════════════════════════════

    async def get_fingerprint(self, audio_data: bytes, tier: str = "fast") -> dict:
        """Extract a fingerprint using either the 'fast' (0.5B) or 'premium' (1.5B) model."""
        model = self.model_large if tier == "premium" and self.model_large else self.model_small
        if not model:
            print(f"[Engine] Warning: Requested {tier} model not loaded. Falling back.")
            model = self.model_small if self.model_small else self.model_large

        audio_np = self._decode_audio(audio_data)
        dtype = torch.bfloat16 if model == self.model_large else torch.float16

        speech_tensor = torch.from_numpy(audio_np).to(device=self.device, dtype=dtype)
        if speech_tensor.ndim == 1:
            speech_tensor = speech_tensor.unsqueeze(0)

        with torch.no_grad():
            acoustic_out = model.acoustic_tokenizer.encode(speech_tensor.unsqueeze(1))
            acoustic_latents = acoustic_out.mean
            acoustic_embeds = model.acoustic_connector(acoustic_latents)

            lm_out = model.forward_lm(inputs_embeds=acoustic_embeds, use_cache=True, return_dict=True)
            speech_mask = torch.zeros((1, acoustic_latents.size(1)), dtype=torch.bool, device=self.device)
            tts_lm_out = model.forward_tts_lm(
                inputs_embeds=acoustic_embeds,
                lm_last_hidden_state=lm_out.last_hidden_state,
                tts_text_masks=speech_mask,
                use_cache=True,
                return_dict=True,
            )

        neg = self._neg_large if model == self.model_large else self._neg_small

        fingerprint = {
            "lm": self._robust_half_explicit(lm_out, dtype),
            "tts_lm": self._robust_half_explicit(tts_lm_out, dtype),
            "neg_lm": neg["lm"],
            "neg_tts_lm": neg["tts_lm"],
        }
        return fingerprint

    # ═══════════════════════════════════════════════════════════════════════════
    # Synchronous Generation (Cloner / Podcast)
    # ═══════════════════════════════════════════════════════════════════════════

    def generate_clone(
        self,
        text: str,
        fingerprint: dict,
        tier: str = "fast",
        output_format: str = "wav",
        cfg_scale: float = 1.5,
    ) -> bytes:
        """Synthesise text using the requested model tier."""
        model = self.model_large if tier == "premium" and self.model_large else self.model_small
        processor = self.processor_large if tier == "premium" and self.processor_large else self.processor_small

        prompt_copy = deepcopy(fingerprint)
        inputs = processor.process_input_with_cached_prompt(
            text=text,
            cached_prompt=prompt_copy,
            padding=True,
            return_tensors="pt",
            return_attention_mask=True,
        )

        for k, v in inputs.items():
            if torch.is_tensor(v):
                inputs[k] = v.to(self.device)

        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                max_new_tokens=1024,
                cfg_scale=cfg_scale,
                tokenizer=processor.tokenizer,
                generation_config={"do_sample": False},
                all_prefilled_outputs=prompt_copy,
                is_prefill=False,
                refresh_negative=True,
            )

        audio_np = outputs.speech_outputs[0].cpu().to(torch.float32).numpy().squeeze()
        return self._encode_audio(audio_np, output_format)

    # ═══════════════════════════════════════════════════════════════════════════
    # Streaming Generation (Interviewer / Real-Time)
    # ═══════════════════════════════════════════════════════════════════════════

    async def generate_stream(
        self,
        text: str,
        fingerprint: dict,
        cfg_scale: float = 1.5,
    ) -> AsyncGenerator[bytes, None]:
        """
        Async generator that yields raw 16-bit PCM chunks (24 kHz, mono).
        Used by the WebSocket Interviewer for streaming TTS.
        """
        from vibevoice.modular.streamer import AsyncAudioStreamer

        prompt_copy = deepcopy(fingerprint)

        inputs = self.processor.process_input_with_cached_prompt(
            text=text,
            cached_prompt=prompt_copy,
            padding=True,
            return_tensors="pt",
        )

        for k, v in inputs.items():
            if torch.is_tensor(v):
                inputs[k] = v.to(self.device)

        streamer = AsyncAudioStreamer(batch_size=1)

        gen_task = asyncio.to_thread(
            self.model.generate,
            **inputs,
            max_new_tokens=1024,
            cfg_scale=cfg_scale,
            tokenizer=self.processor.tokenizer,
            audio_streamer=streamer,
            all_prefilled_outputs=prompt_copy,
            is_prefill=False,
        )

        asyncio.create_task(gen_task)

        async for audio_chunk in streamer.get_stream(0):
            audio_np = audio_chunk.cpu().float().numpy().squeeze()
            pcm_bytes = (audio_np * 32767).astype(np.int16).tobytes()
            yield pcm_bytes

    # ═══════════════════════════════════════════════════════════════════════════
    # Audio Utilities
    # ═══════════════════════════════════════════════════════════════════════════

    @staticmethod
    def _decode_audio(audio_data: bytes, target_sr: int = 24000) -> np.ndarray:
        """Decode .wav or .mp3 bytes and resample to target_sr mono."""
        try:
            # Try soundfile first (WAV, FLAC, OGG)
            with io.BytesIO(audio_data) as buf:
                audio_np, sr = sf.read(buf)
        except Exception:
            # Fallback to pydub for MP3 and other formats
            from pydub import AudioSegment
            seg = AudioSegment.from_file(io.BytesIO(audio_data))
            sr = seg.frame_rate
            samples = np.array(seg.get_array_of_samples(), dtype=np.float32)
            if seg.channels > 1:
                samples = samples.reshape(-1, seg.channels).mean(axis=1)
            audio_np = samples / 32768.0

        # Resample if needed
        if sr != target_sr:
            audio_np = librosa.resample(audio_np, orig_sr=sr, target_sr=target_sr)

        # Ensure mono
        if len(audio_np.shape) > 1:
            audio_np = np.mean(audio_np, axis=1)

        return audio_np.astype(np.float32)

    @staticmethod
    def _encode_audio(
        audio_np: np.ndarray,
        fmt: str = "wav",
        sample_rate: int = 24000,
    ) -> bytes:
        """Encode numpy audio to WAV or MP3 bytes."""
        buf = io.BytesIO()

        if fmt == "mp3":
            from pydub import AudioSegment
            audio_int16 = (audio_np * 32767).astype(np.int16)
            seg = AudioSegment(
                audio_int16.tobytes(),
                frame_rate=sample_rate,
                sample_width=2,
                channels=1,
            )
            seg.export(buf, format="mp3")
        else:
            sf.write(buf, audio_np, sample_rate, format="WAV")

        buf.seek(0)
        return buf.read()

    @staticmethod
    def generate_silence(duration_ms: int = 200, sample_rate: int = 24000) -> bytes:
        """Generate silent WAV bytes of given duration."""
        num_samples = int(sample_rate * duration_ms / 1000)
        silence = np.zeros(num_samples, dtype=np.float32)
        buf = io.BytesIO()
        sf.write(buf, silence, sample_rate, format="WAV")
        buf.seek(0)
        return buf.read()
