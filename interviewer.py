"""
WebSocket Interviewer — Full-Duplex Real-Time Pipeline
──────────────────────────────────────────────────────
Protocol:
  Client → Server:  Binary audio frames (16 kHz, 16-bit PCM, mono)
                     JSON control:  {"event": "start"} / {"event": "stop"}

  Server → Client:  Binary audio frames (24 kHz, 16-bit PCM, mono) — TTS output
                     JSON control:  {"event": "transcript", "text": "..."}
                                    {"event": "response",   "text": "..."}
                                    {"event": "listening"}  
                                    {"event": "speaking"}
                                    {"event": "interrupt"}

Pipeline:
  User Audio → VAD (Silero) → ASR (faster-whisper) → Gemini Flash → TTS Streaming
"""

import os
import io
import json
import asyncio
import torch
import numpy as np
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect


# ─── VAD (Silero Voice Activity Detection) ─────────────────────────────────────

class SileroVAD:
    """
    GPU-accelerated Voice Activity Detection using Silero VAD v5.
    Processes 16 kHz audio in 512-sample (32ms) chunks.
    """

    def __init__(self, threshold: float = 0.5, device: str = "cuda"):
        self.threshold = threshold
        self.device = device

        # Load Silero VAD model
        self.model, utils = torch.hub.load(
            repo_or_dir="snakers4/silero-vad",
            model="silero_vad",
            force_reload=False,
            onnx=False,
        )
        self.model = self.model.to(device)

        self._speech_active = False
        self._silence_frames = 0
        self._silence_threshold = 15  # ~480ms of silence triggers end-of-speech

    def reset(self):
        """Reset VAD state for a new utterance."""
        self.model.reset_states()
        self._speech_active = False
        self._silence_frames = 0

    def process_chunk(self, audio_chunk: np.ndarray) -> dict:
        """
        Process a 512-sample chunk of 16kHz audio.
        Returns: {"is_speech": bool, "speech_start": bool, "speech_end": bool}
        """
        tensor = torch.from_numpy(audio_chunk).float().to(self.device)
        if tensor.ndim == 1:
            tensor = tensor.unsqueeze(0)

        confidence = self.model(tensor, 16000).item()
        is_speech = confidence > self.threshold

        speech_start = False
        speech_end = False

        if is_speech:
            self._silence_frames = 0
            if not self._speech_active:
                self._speech_active = True
                speech_start = True
        else:
            if self._speech_active:
                self._silence_frames += 1
                if self._silence_frames >= self._silence_threshold:
                    self._speech_active = False
                    speech_end = True

        return {
            "is_speech": is_speech,
            "speech_start": speech_start,
            "speech_end": speech_end,
            "confidence": confidence,
        }


# ─── ASR (Speech-to-Text via faster-whisper) ──────────────────────────────────

class WhisperASR:
    """
    Real-time ASR using faster-whisper (CTranslate2 backend).
    Runs Whisper Small (~1GB) on GPU alongside VibeVoice.
    """

    def __init__(self, model_size: str = "small", device: str = "cuda"):
        from faster_whisper import WhisperModel

        compute_type = "float16" if device == "cuda" else "int8"
        self.model = WhisperModel(
            model_size,
            device=device,
            compute_type=compute_type,
        )
        print(f"[ASR] Loaded faster-whisper ({model_size}) on {device}")

    def transcribe(self, audio_np: np.ndarray, language: str = "en") -> str:
        """
        Transcribe a numpy audio array (16kHz float32 mono).
        Returns the transcribed text.
        """
        segments, info = self.model.transcribe(
            audio_np,
            beam_size=3,
            language=language,
            vad_filter=False,   # We handle VAD externally
            word_timestamps=False,
        )

        text = " ".join(seg.text.strip() for seg in segments)
        return text.strip()


# ─── LLM (Gemini Flash for conversational responses) ──────────────────────────

class GeminiConversation:
    """
    Manages a multi-turn conversation with Gemini 1.5 Flash.
    Supports configurable system roles (interviewer, tutor, etc.).
    """

    def __init__(self, system_role: str = "tech_interviewer"):
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY not set.")

        from google import genai

        self.client = genai.Client(api_key=api_key)

        self.system_prompts = {
            "tech_interviewer": (
                "You are a senior technical interviewer conducting a coding interview. "
                "Ask clear, specific technical questions. Give brief, encouraging responses. "
                "Follow up on the candidate's answers. Keep responses under 3 sentences."
            ),
            "language_tutor": (
                "You are a friendly language tutor. Correct mistakes gently, "
                "provide examples, and keep the conversation flowing naturally. "
                "Keep responses under 3 sentences."
            ),
            "general": (
                "You are a helpful conversational AI assistant. "
                "Keep responses concise and natural for spoken dialogue. "
                "Limit responses to 2-3 sentences."
            ),
        }

        self.system_prompt = self.system_prompts.get(system_role, self.system_prompts["general"])
        self.history: list[dict] = []

    async def get_response(self, user_text: str) -> str:
        """Send user text to Gemini and get a conversational response."""
        self.history.append({"role": "user", "text": user_text})

        # Build conversation context
        context = f"System: {self.system_prompt}\n\n"
        for turn in self.history[-10:]:  # Keep last 10 turns for context
            role = "User" if turn["role"] == "user" else "Assistant"
            context += f"{role}: {turn['text']}\n"
        context += "Assistant:"

        response = self.client.models.generate_content(
            model="gemini-2.0-flash",
            contents=context,
        )

        assistant_text = response.text.strip()
        self.history.append({"role": "assistant", "text": assistant_text})

        return assistant_text

    async def get_response_streamed(self, user_text: str):
        """
        Stream Gemini's response sentence by sentence.
        Yields complete sentences as they form, enabling interleaved TTS.
        """
        full_response = await self.get_response(user_text)

        # Split into sentences for interleaved TTS streaming
        import re
        sentences = re.split(r'(?<=[.!?])\s+', full_response)
        for sentence in sentences:
            sentence = sentence.strip()
            if sentence:
                yield sentence


# ─── Interview Session (Orchestrator) ─────────────────────────────────────────

class InterviewSession:
    """
    Manages a single WebSocket interview session.
    Coordinates VAD → ASR → LLM → TTS pipeline.
    """

    def __init__(
        self,
        websocket: WebSocket,
        engine,
        voice: str = "Carter (US Male)",
        role: str = "tech_interviewer",
        sample_rate: int = 16000,
    ):
        self.ws = websocket
        self.engine = engine
        self.voice = voice
        self.sample_rate = sample_rate

        # Pipeline components
        device = "cuda" if torch.cuda.is_available() else "cpu"
        self.vad = SileroVAD(device=device)
        self.asr = WhisperASR(device=device)
        self.llm = GeminiConversation(system_role=role)

        # State
        self._audio_buffer: list[np.ndarray] = []
        self._is_speaking = False        # AI is currently generating TTS
        self._generation_task: Optional[asyncio.Task] = None
        self._interrupted = False

    async def run(self):
        """Main loop: receive audio frames, process through pipeline."""
        # Load voice preset
        fingerprint = self.engine.load_voice_preset(self.voice)

        # Send initial greeting
        greeting = await self.llm.get_response(
            "The interview has just started. Greet the candidate briefly."
        )
        await self._send_json({"event": "response", "text": greeting})
        await self._speak(greeting, fingerprint)
        await self._send_json({"event": "listening"})

        try:
            while True:
                data = await self.ws.receive()

                if "bytes" in data and data["bytes"]:
                    await self._handle_audio(data["bytes"], fingerprint)
                elif "text" in data and data["text"]:
                    await self._handle_control(json.loads(data["text"]), fingerprint)

        except WebSocketDisconnect:
            print("[Interview] Client disconnected.")
        except Exception as e:
            print(f"[Interview] Error: {e}")
            import traceback
            traceback.print_exc()

    async def _handle_audio(self, raw_bytes: bytes, fingerprint: dict):
        """Process incoming audio through VAD → buffer → ASR."""
        # Decode 16-bit PCM to float32
        audio_np = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        # Run VAD
        # Process in 512-sample chunks (32ms at 16kHz)
        chunk_size = 512
        for i in range(0, len(audio_np), chunk_size):
            chunk = audio_np[i:i + chunk_size]
            if len(chunk) < chunk_size:
                chunk = np.pad(chunk, (0, chunk_size - len(chunk)))

            vad_result = self.vad.process_chunk(chunk)

            if vad_result["speech_start"]:
                # ── User started speaking ──────────────────────────────────
                self._audio_buffer = []

                # Interrupt AI if it's currently speaking
                if self._is_speaking:
                    await self._interrupt()

            if vad_result["is_speech"] or self.vad._speech_active:
                self._audio_buffer.append(chunk)

            if vad_result["speech_end"] and self._audio_buffer:
                # ── User finished speaking → transcribe ────────────────────
                full_audio = np.concatenate(self._audio_buffer)
                self._audio_buffer = []

                # Transcribe
                transcript = self.asr.transcribe(full_audio)
                if not transcript:
                    continue

                await self._send_json({"event": "transcript", "text": transcript})
                print(f"[Interview] User: {transcript}")

                # Get LLM response and speak it
                self._interrupted = False
                self._generation_task = asyncio.create_task(
                    self._respond_and_speak(transcript, fingerprint)
                )

    async def _handle_control(self, msg: dict, fingerprint: dict):
        """Handle JSON control messages."""
        event = msg.get("event")
        if event == "stop":
            await self._interrupt()

    async def _respond_and_speak(self, user_text: str, fingerprint: dict):
        """Get LLM response and stream TTS back to client."""
        try:
            await self._send_json({"event": "speaking"})
            self._is_speaking = True

            # Stream sentence-by-sentence from Gemini
            async for sentence in self.llm.get_response_streamed(user_text):
                if self._interrupted:
                    break

                await self._send_json({"event": "response", "text": sentence})
                print(f"[Interview] AI: {sentence}")

                # Stream TTS for this sentence
                await self._speak(sentence, fingerprint)

                if self._interrupted:
                    break

        finally:
            self._is_speaking = False
            self.vad.reset()
            if not self._interrupted:
                await self._send_json({"event": "listening"})

    async def _speak(self, text: str, fingerprint: dict):
        """Stream TTS audio back over the WebSocket as binary frames."""
        try:
            async for pcm_chunk in self.engine.generate_stream(text, fingerprint):
                if self._interrupted:
                    break
                await self.ws.send_bytes(pcm_chunk)
        except Exception as e:
            print(f"[Interview] TTS streaming error: {e}")

    async def _interrupt(self):
        """Interrupt current AI speech."""
        self._interrupted = True
        if self._generation_task and not self._generation_task.done():
            self._generation_task.cancel()
        self._is_speaking = False
        self.vad.reset()
        await self._send_json({"event": "interrupt"})
        print("[Interview] Interrupted by user.")

    async def _send_json(self, data: dict):
        """Send a JSON control message to the client."""
        try:
            await self.ws.send_text(json.dumps(data))
        except Exception:
            pass
