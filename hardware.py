"""
Hardware Adaptive Logic
───────────────────────
Detects GPU VRAM at startup and selects the optimal model loading strategy.

Tiers:
  LOW  (<16GB):  Realtime-0.5B in NF4 4-bit quantization (RTX 3060, etc.)
  HIGH (≥24GB):  1.5B in BF16 + torch.compile (A100, H100, RTX 4090)
"""

import os
import torch
from dataclasses import dataclass
from typing import Optional, Literal


@dataclass
class HardwareProfile:
    """Describes the GPU capabilities and the model strategy derived from them."""
    gpu_name: str
    vram_gb: float
    tier: Literal["low", "high"]
    # Which models to load
    primary_model_id: str          # Main model for cloning / podcast
    realtime_model_id: str         # Always Realtime-0.5B for streaming interviews
    # Precision & optimisation
    dtype: torch.dtype
    quantize: Optional[str]        # "nf4" or None
    use_compile: bool              # torch.compile for ~30% throughput boost
    ddpm_steps: int                # diffusion sampling steps (speed vs quality)


# ─── Constants ─────────────────────────────────────────────────────────────────
REALTIME_MODEL = "microsoft/VibeVoice-Realtime-0.5B"
FULL_MODEL     = "microsoft/VibeVoice-1.5B"

# Thresholds
VRAM_THRESHOLD_HIGH = 18.0   # Lowered to 18GB to support RTX 4000 Ada (20GB) in High-Tier
VRAM_THRESHOLD_LOW  = 12.0   # Anything < 12GB is strictly low-tier


def detect_hardware() -> HardwareProfile:
    """
    Probe the first CUDA device and return a HardwareProfile with the
    optimal loading strategy.  Falls back to CPU-safe defaults if no GPU.
    """
    # Check for High Density environment flag
    high_density = os.getenv("HIGH_DENSITY", "0") == "1"

    if not torch.cuda.is_available():
        print(_banner("CPU", 0, "low"))
        return HardwareProfile(
            gpu_name="CPU (no CUDA)",
            vram_gb=0,
            tier="low",
            primary_model_id=REALTIME_MODEL,
            realtime_model_id=REALTIME_MODEL,
            dtype=torch.float32,
            quantize=None,
            use_compile=False,
            ddpm_steps=5,
        )

    props = torch.cuda.get_device_properties(0)
    gpu_name = props.name
    vram_gb  = round(props.total_memory / (1024 ** 3), 1)

    if vram_gb >= VRAM_THRESHOLD_HIGH:
        # ── HIGH tier: RTX 4000 Ada / RTX 6000 / A100 ──────────────────────
        # If high density is requested for 10-20 users, we use NF4 even on high-end cards
        tier = "high"
        quantize = "nf4" if high_density else None
        ddpm_steps = 3 if high_density else 10  # Drop steps to 3 for speed if busy

        profile = HardwareProfile(
            gpu_name=gpu_name,
            vram_gb=vram_gb,
            tier=tier,
            primary_model_id=FULL_MODEL,
            realtime_model_id=REALTIME_MODEL,
            dtype=torch.bfloat16,
            quantize=quantize,
            use_compile=True,
            ddpm_steps=ddpm_steps,
        )
    else:
        # ── LOW tier: RTX 3060 / 3070 / T4 ─────────────────────────────────
        profile = HardwareProfile(
            gpu_name=gpu_name,
            vram_gb=vram_gb,
            tier="low",
            primary_model_id=REALTIME_MODEL,
            realtime_model_id=REALTIME_MODEL,
            dtype=torch.float16,
            quantize="nf4",
            use_compile=False,
            ddpm_steps=5,
        )

    banner_tier = f"{profile.tier} (DENSITY MODE)" if high_density else profile.tier
    print(_banner(gpu_name, vram_gb, banner_tier))
    return profile


def get_bnb_config():
    """Return a BitsAndBytesConfig for NF4 4-bit quantization."""
    from transformers import BitsAndBytesConfig
    return BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
    )


# ─── Pretty Print ──────────────────────────────────────────────────────────────

def _banner(gpu: str, vram: float, tier: str) -> str:
    bar = "═" * 60
    return (
        f"\n╔{bar}╗\n"
        f"║  VibeVoice AI Audio Engine — Hardware Detection           ║\n"
        f"╠{bar}╣\n"
        f"║  GPU:    {gpu:<49}║\n"
        f"║  VRAM:   {vram:<49}║\n"
        f"║  Tier:   {tier.upper():<49}║\n"
        f"║  Quant:  {'NF4 4-bit' if tier == 'low' and vram > 0 else 'None (full precision)':<49}║\n"
        f"║  Compile: {'Enabled (reduce-overhead)' if tier == 'high' else 'Disabled':<49}║\n"
        f"╚{bar}╝"
    )
