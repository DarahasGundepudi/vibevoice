"""
Podcast Builder
───────────────
Converts article text (or a URL) into a multi-speaker podcast:

  1. Fetch article text (if URL provided)
  2. Send to Gemini 1.5 Flash → structured multi-speaker JSON script
  3. Synthesise each speaker turn via VibeEngine
  4. Stitch segments with 200 ms silence gaps via FFmpeg
"""

import os
import io
import json
import uuid
import time
import shutil
import tempfile
import subprocess
import numpy as np
import soundfile as sf
from typing import Optional
from dataclasses import dataclass, field

# ─── Types ─────────────────────────────────────────────────────────────────────

@dataclass
class PodcastTask:
    task_id: str
    status: str = "processing"       # processing | complete | failed
    error: Optional[str] = None
    output_path: Optional[str] = None
    script: list = field(default_factory=list)
    created_at: float = field(default_factory=time.time)

# Global task registry (in-memory; swap for Redis in prod)
_tasks: dict[str, PodcastTask] = {}

# Speaker → Voice Preset mapping
SPEAKER_VOICES = {
    "Host":    "Carter (US Male)",
    "Guest 1": "Emma (US Female)",
    "Guest 2": "Davis (US Male)",
    "Guest 3": "Frank (US Male)",
}


# ─── 1. Article Extraction ────────────────────────────────────────────────────

def fetch_article_text(url: str) -> str:
    """Download a URL and extract the main article body as plain text."""
    try:
        import trafilatura
        downloaded = trafilatura.fetch_url(url)
        text = trafilatura.extract(downloaded)
        if text:
            return text
    except ImportError:
        pass

    # Fallback: raw HTML fetch with httpx
    import httpx
    resp = httpx.get(url, follow_redirects=True, timeout=15)
    resp.raise_for_status()

    # Crude text extraction from HTML
    from html.parser import HTMLParser

    class _TextExtractor(HTMLParser):
        def __init__(self):
            super().__init__()
            self.texts = []
            self._skip = False
        def handle_starttag(self, tag, attrs):
            if tag in ("script", "style", "nav", "header", "footer"):
                self._skip = True
        def handle_endtag(self, tag):
            if tag in ("script", "style", "nav", "header", "footer"):
                self._skip = False
        def handle_data(self, data):
            if not self._skip:
                stripped = data.strip()
                if stripped:
                    self.texts.append(stripped)

    parser = _TextExtractor()
    parser.feed(resp.text)
    return "\n".join(parser.texts)


# ─── 2. Gemini Script Generation ──────────────────────────────────────────────

SCRIPT_SYSTEM_PROMPT = """You are an expert podcast script writer.  Convert the given article into 
an engaging, natural-sounding podcast conversation between 3 speakers:
- Host: the main presenter who drives the discussion
- Guest 1: an expert who provides deeper insight
- Guest 2: a curious listener who asks clarifying questions

Rules:
1. Output ONLY a JSON array, no markdown fences, no explanation.
2. Each element: {"speaker": "Host"|"Guest 1"|"Guest 2", "text": "..."}
3. Keep each turn to 1-3 sentences for natural pacing.
4. Start with the Host introducing the topic.
5. Include at least 8 turns total.
6. End with the Host wrapping up.
"""


async def generate_script(content: str) -> list[dict]:
    """
    Call Gemini 1.5 Flash to convert article text into a multi-speaker script.
    Returns a list of {"speaker": str, "text": str} dicts.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set.  Add it to your .env file.")

    from google import genai

    client = genai.Client(api_key=api_key)

    # Truncate very long articles to ~6000 words to stay within token limits
    words = content.split()
    if len(words) > 6000:
        content = " ".join(words[:6000]) + "\n\n[Article truncated for podcast]"

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=f"{SCRIPT_SYSTEM_PROMPT}\n\n---\nARTICLE:\n{content}",
    )

    raw = response.text.strip()

    # Strip markdown code fences if Gemini wraps them
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1] if lines[-1].startswith("```") else lines[1:])

    script = json.loads(raw)

    # Validate structure
    for turn in script:
        if "speaker" not in turn or "text" not in turn:
            raise ValueError(f"Invalid script turn: {turn}")

    return script


# ─── 3. Synthesis + Stitching ─────────────────────────────────────────────────

def assign_voices(script: list[dict]) -> list[dict]:
    """Attach a voice preset name to each script turn."""
    for turn in script:
        speaker = turn["speaker"]
        turn["voice"] = SPEAKER_VOICES.get(speaker, "Carter (US Male)")
    return script


async def synthesize_and_stitch(task: PodcastTask, engine) -> None:
    """
    Background task: synthesise each turn and stitch with FFmpeg.
    Updates the PodcastTask in-place with progress and final output path.
    """
    import asyncio

    output_dir = os.getenv("PODCAST_OUTPUT_DIR", os.path.join(tempfile.gettempdir(), "vibevoice_podcasts"))
    os.makedirs(output_dir, exist_ok=True)

    tmpdir = tempfile.mkdtemp(prefix="podcast_")
    segment_files = []

    try:
        script = assign_voices(task.script)
        silence_path = os.path.join(tmpdir, "silence.wav")

        # Pre-generate 200ms silence segment
        silence_np = np.zeros(int(24000 * 0.2), dtype=np.float32)
        sf.write(silence_path, silence_np, 24000, format="WAV")

        # ── Synthesise each turn ────────────────────────────────────────────
        for i, turn in enumerate(script):
            print(f"[Podcast] Synthesising turn {i+1}/{len(script)}: {turn['speaker']}")

            # Load voice preset (or use fingerprint if custom)
            preset = engine.load_voice_preset(turn["voice"])

            # Generate audio
            wav_bytes = engine.generate_clone(
                text=turn["text"],
                fingerprint=preset,
                output_format="wav",
            )

            seg_path = os.path.join(tmpdir, f"seg_{i:04d}.wav")
            with open(seg_path, "wb") as f:
                f.write(wav_bytes)

            segment_files.append(seg_path)
            segment_files.append(silence_path)  # 200ms gap after each turn

        # ── Build FFmpeg concat list ────────────────────────────────────────
        concat_list_path = os.path.join(tmpdir, "concat.txt")
        with open(concat_list_path, "w") as f:
            for seg in segment_files:
                # FFmpeg requires forward slashes and escaped quotes
                safe_path = seg.replace("\\", "/")
                f.write(f"file '{safe_path}'\n")

        # ── Stitch with FFmpeg ──────────────────────────────────────────────
        output_path = os.path.join(output_dir, f"{task.task_id}.wav")
        cmd = [
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", concat_list_path,
            "-c:a", "pcm_s16le",
            "-ar", "24000",
            "-ac", "1",
            output_path,
        ]

        print(f"[Podcast] Stitching {len(script)} segments with FFmpeg...")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg failed: {result.stderr}")

        task.output_path = output_path
        task.status = "complete"
        print(f"[Podcast] Complete → {output_path}")

    except Exception as e:
        task.status = "failed"
        task.error = str(e)
        import traceback
        traceback.print_exc()

    finally:
        # Cleanup temp segments (keep output)
        shutil.rmtree(tmpdir, ignore_errors=True)


# ─── Task Management ──────────────────────────────────────────────────────────

def create_task(script: list[dict]) -> PodcastTask:
    """Register a new podcast task."""
    task = PodcastTask(
        task_id=uuid.uuid4().hex[:12],
        script=script,
    )
    _tasks[task.task_id] = task
    return task


def get_task(task_id: str) -> Optional[PodcastTask]:
    """Retrieve a podcast task by ID."""
    return _tasks.get(task_id)
