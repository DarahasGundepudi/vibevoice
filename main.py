"""
VibeVoice AI Audio Engine — Unified FastAPI Server
───────────────────────────────────────────────────
Production-grade backend serving:

  POST /cloner/generate       — Zero-shot voice cloning
  POST /podcast/build         — Multi-speaker podcast from article/URL
  GET  /podcast/status/{id}   — Poll podcast build status
  GET  /podcast/download/{id} — Download finished podcast
  WS   /ws/realtime           — Full-duplex real-time interviewer
  GET  /health                — Hardware-aware health check
  GET  /voices                — List available voice presets
"""

import os
import time
import asyncio
from contextlib import asynccontextmanager

import uvicorn
from dotenv import load_dotenv
from fastapi import (
    FastAPI,
    UploadFile,
    File,
    Form,
    WebSocket,
    BackgroundTasks,
    HTTPException,
    Query,
)
from fastapi.responses import (
    StreamingResponse,
    FileResponse,
    HTMLResponse,
    JSONResponse,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

# Load .env before anything else
load_dotenv()

# Local modules
from hardware import detect_hardware, HardwareProfile
from engine import VibeEngine

# Lazy imports for endpoints (avoid loading heavy deps at import time)
# podcast and interviewer are imported inside their endpoint functions

# ─── Global State ──────────────────────────────────────────────────────────────

engine: Optional[VibeEngine] = None
hw_profile: Optional[HardwareProfile] = None
_start_time: float = 0


# ─── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global engine, hw_profile, _start_time
    _start_time = time.time()

    print("=" * 64)
    print("  VibeVoice AI Audio Engine")
    print("  Voice Cloning · Podcasts · Real-Time Interviews")
    print("=" * 64)

    # 1. Detect hardware
    hw_profile = detect_hardware()

    # 2. Load engine with optimal strategy
    engine = VibeEngine(profile=hw_profile)

    print("=" * 64)
    print("  All systems operational.  Endpoints:")
    print("    POST /cloner/generate")
    print("    POST /podcast/build")
    print("    WS   /ws/realtime")
    print("    GET  /health")
    print("=" * 64)

    yield

    # Cleanup
    print("[Server] Shutting down...")
    del engine


# ─── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="VibeVoice AI Audio Engine",
    description="Unified API for voice cloning, podcasting, and real-time interviews",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════════════════════════════════════════════════════════════
# HEALTH & INFO
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    """Hardware-aware health check with GPU stats."""
    import torch

    gpu_info = {}
    if torch.cuda.is_available():
        gpu_info = {
            "gpu_name": torch.cuda.get_device_name(0),
            "vram_total_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 2),
            "vram_allocated_gb": round(torch.cuda.memory_allocated() / 1024**3, 2),
            "vram_reserved_gb": round(torch.cuda.memory_reserved() / 1024**3, 2),
        }

    return {
        "status": "ok",
        "hardware_tier": hw_profile.tier if hw_profile else "unknown",
        "model": hw_profile.primary_model_id if hw_profile else "unknown",
        "quantization": hw_profile.quantize if hw_profile else None,
        "torch_compile": hw_profile.use_compile if hw_profile else False,
        "gpu": gpu_info,
        "uptime_seconds": round(time.time() - _start_time, 1),
    }


@app.get("/voices")
async def list_voices():
    """List all available voice presets."""
    if not engine:
        raise HTTPException(503, "Engine not ready")
    return {"voices": engine.get_available_voices()}


# ═══════════════════════════════════════════════════════════════════════════════
# ENDPOINT 1: CLONER
# ═══════════════════════════════════════════════════════════════════════════════

ALLOWED_AUDIO_TYPES = {
    "audio/wav", "audio/x-wav", "audio/wave",
    "audio/mpeg", "audio/mp3",
    "audio/ogg", "audio/flac",
    "application/octet-stream",  # Some clients send this
}


@app.post("/cloner/generate")
async def cloner_generate(
    text: str = Form(..., description="Text to synthesise in the cloned voice"),
    voice: UploadFile = File(..., description="Reference voice sample (.wav or .mp3)"),
    tier: str = Form("premium", description="Model tier: fast (0.5B) or premium (1.5B)"),
    format: str = Form("wav", description="Output format: wav or mp3"),
):
    """
    Zero-shot voice cloning with Dual-Engine support.
    """
    if not engine:
        raise HTTPException(503, "Engine still loading")

    start = time.time()
    try:
        audio_data = await voice.read()
        print(f"[Cloner] Received {len(audio_data)} bytes. Tier: {tier}")

        # 1. Extract fingerprint using the requested tier
        fingerprint = await engine.get_fingerprint(audio_data, tier=tier)
        fp_time = time.time() - start

        # 2. Synthesise using the same tier
        audio_bytes = engine.generate_clone(
            text=text,
            fingerprint=fingerprint,
            tier=tier,
            output_format=format,
        )

        total_time = time.time() - start
        content_type = "audio/mpeg" if format == "mp3" else "audio/wav"
        return StreamingResponse(
            iter([audio_bytes]),
            media_type=content_type,
            headers={
                "X-Generation-Time": f"{total_time:.3f}",
                "X-Hardware-Tier": tier,
                "Content-Disposition": f'attachment; filename="clone_{tier}.{format}"',
            },
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"Cloning failed: {e}")

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"Cloning failed: {e}")


# ═══════════════════════════════════════════════════════════════════════════════
# ENDPOINT 2: PODCAST
# ═══════════════════════════════════════════════════════════════════════════════

class PodcastRequest(BaseModel):
    content: str  # Article text or URL


@app.post("/podcast/build", status_code=202)
async def podcast_build(request: PodcastRequest, background_tasks: BackgroundTasks):
    """
    Build a multi-speaker podcast from an article or URL.

    1. If content is a URL, fetches and extracts the article text.
    2. Calls Gemini 1.5 Flash to generate a 3-speaker podcast script.
    3. Returns 202 Accepted + task_id immediately.
    4. Background task synthesises all speaker turns and stitches with FFmpeg.
    5. Poll /podcast/status/{task_id} for progress.
    """
    if not engine:
        raise HTTPException(503, "Engine still loading")

    from podcast import fetch_article_text, generate_script, create_task, synthesize_and_stitch

    try:
        content = request.content.strip()

        # If it looks like a URL, fetch the article
        if content.startswith("http://") or content.startswith("https://"):
            print(f"[Podcast] Fetching article from URL: {content[:80]}...")
            content = fetch_article_text(content)

        if len(content) < 50:
            raise HTTPException(400, "Content too short.  Provide at least a paragraph.")

        # Generate multi-speaker script via Gemini
        print("[Podcast] Generating script via Gemini...")
        script = await generate_script(content)
        print(f"[Podcast] Script created: {len(script)} turns")

        # Create task and launch background synthesis
        task = create_task(script)
        background_tasks.add_task(synthesize_and_stitch, task, engine)

        return {
            "task_id": task.task_id,
            "status": "processing",
            "turns": len(script),
            "script": script,
            "poll_url": f"/podcast/status/{task.task_id}",
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"Podcast generation failed: {e}")


@app.get("/podcast/status/{task_id}")
async def podcast_status(task_id: str):
    """Check the status of a podcast build task."""
    from podcast import get_task

    task = get_task(task_id)
    if not task:
        raise HTTPException(404, f"Task '{task_id}' not found")

    result = {
        "task_id": task.task_id,
        "status": task.status,
    }

    if task.status == "complete":
        result["download_url"] = f"/podcast/download/{task.task_id}"
    elif task.status == "failed":
        result["error"] = task.error

    return result


@app.get("/podcast/download/{task_id}")
async def podcast_download(task_id: str):
    """Download a completed podcast WAV file."""
    from podcast import get_task

    task = get_task(task_id)
    if not task:
        raise HTTPException(404, f"Task '{task_id}' not found")
    if task.status != "complete":
        raise HTTPException(409, f"Task is still {task.status}")
    if not task.output_path or not os.path.exists(task.output_path):
        raise HTTPException(500, "Output file missing")

    return FileResponse(
        task.output_path,
        media_type="audio/wav",
        filename=f"podcast_{task.task_id}.wav",
    )


# ═══════════════════════════════════════════════════════════════════════════════
# ENDPOINT 3: REAL-TIME INTERVIEWER (WebSocket)
# ═══════════════════════════════════════════════════════════════════════════════

@app.websocket("/ws/realtime")
async def ws_realtime(
    websocket: WebSocket,
    voice: str = Query("Carter (US Male)", description="Voice preset name"),
    role: str = Query("tech_interviewer", description="System role"),
    sample_rate: int = Query(16000, description="Input audio sample rate"),
):
    """
    Full-duplex WebSocket for real-time AI interviewing.

    Protocol:
      → Binary frames: 16-bit PCM audio from user's mic
      → JSON frames:   {"event": "start"} / {"event": "stop"}
      ← Binary frames: 24 kHz 16-bit PCM TTS audio
      ← JSON frames:   {"event": "transcript|response|listening|speaking|interrupt", ...}

    Query Params:
      voice: Voice preset name (default: "Carter (US Male)")
      role:  System role (tech_interviewer, language_tutor, general)
      sample_rate: Input audio sample rate (default: 16000)
    """
    if not engine:
        await websocket.close(code=1013, reason="Engine not ready")
        return

    await websocket.accept()
    print(f"[WS] Client connected  voice={voice}  role={role}")

    from interviewer import InterviewSession

    session = InterviewSession(
        websocket=websocket,
        engine=engine,
        voice=voice,
        role=role,
        sample_rate=sample_rate,
    )

    await session.run()
    print("[WS] Session ended.")


# ═══════════════════════════════════════════════════════════════════════════════
# ROOT — Quick Testing UI
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/", response_class=HTMLResponse)
async def index():
    """Simple test UI for the Cloner endpoint."""
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>VibeVoice AI Audio Engine</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
        <style>
            :root {
                --bg: #0a0e1a;
                --card: #111827;
                --border: #1f2937;
                --accent: #6366f1;
                --accent-glow: rgba(99, 102, 241, 0.3);
                --success: #10b981;
                --text: #f1f5f9;
                --muted: #94a3b8;
            }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
                font-family: 'Inter', sans-serif;
                background: var(--bg);
                color: var(--text);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 2rem;
            }
            .engine-card {
                background: var(--card);
                border: 1px solid var(--border);
                border-radius: 1.25rem;
                padding: 2.5rem;
                width: 100%;
                max-width: 560px;
                box-shadow: 0 0 60px rgba(0,0,0,0.5), 0 0 20px var(--accent-glow);
            }
            .engine-badge {
                display: inline-flex;
                align-items: center;
                gap: 0.5rem;
                background: rgba(99,102,241,0.1);
                border: 1px solid rgba(99,102,241,0.3);
                border-radius: 2rem;
                padding: 0.35rem 1rem;
                font-size: 0.75rem;
                font-weight: 600;
                color: var(--accent);
                margin-bottom: 1.25rem;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }
            .engine-badge::before { content: "⚡"; }
            h1 {
                font-size: 1.75rem;
                font-weight: 700;
                margin-bottom: 0.25rem;
                background: linear-gradient(135deg, #6366f1, #a78bfa, #c084fc);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .subtitle { color: var(--muted); font-size: 0.875rem; margin-bottom: 2rem; }
            label {
                display: block;
                font-weight: 600;
                font-size: 0.8rem;
                color: var(--muted);
                margin-bottom: 0.5rem;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }
            input[type="file"], textarea {
                width: 100%;
                padding: 0.875rem 1rem;
                border-radius: 0.75rem;
                border: 1px solid var(--border);
                background: var(--bg);
                color: var(--text);
                font-family: inherit;
                font-size: 0.9rem;
                margin-bottom: 1.5rem;
                transition: border-color 0.2s;
            }
            input[type="file"]:focus, textarea:focus {
                outline: none;
                border-color: var(--accent);
                box-shadow: 0 0 0 3px var(--accent-glow);
            }
            textarea { resize: vertical; min-height: 80px; }
            .btn-generate {
                width: 100%;
                padding: 1rem;
                border: none;
                border-radius: 0.75rem;
                background: linear-gradient(135deg, #6366f1, #8b5cf6);
                color: white;
                font-family: inherit;
                font-size: 1rem;
                font-weight: 600;
                cursor: pointer;
                transition: transform 0.1s, box-shadow 0.2s;
            }
            .btn-generate:hover {
                box-shadow: 0 0 20px var(--accent-glow);
                transform: translateY(-1px);
            }
            .btn-generate:active { transform: scale(0.98); }
            .btn-generate:disabled { opacity: 0.5; cursor: not-allowed; }
            #status {
                margin-top: 1rem;
                text-align: center;
                font-size: 0.85rem;
                color: var(--muted);
                min-height: 1.5em;
            }
            .audio-result {
                margin-top: 1.5rem;
                padding: 1.25rem;
                background: var(--bg);
                border: 1px solid var(--border);
                border-radius: 0.75rem;
                display: none;
            }
            .audio-result.show { display: block; }
            audio { width: 100%; margin-top: 0.5rem; }
            .endpoints {
                margin-top: 2rem;
                padding-top: 1.5rem;
                border-top: 1px solid var(--border);
            }
            .endpoint-row {
                display: flex;
                align-items: center;
                gap: 0.75rem;
                padding: 0.5rem 0;
                font-size: 0.8rem;
            }
            .method {
                padding: 0.2rem 0.5rem;
                border-radius: 0.25rem;
                font-weight: 700;
                font-size: 0.7rem;
                font-family: monospace;
            }
            .method.post { background: #064e3b; color: #34d399; }
            .method.ws { background: #4c1d95; color: #c4b5fd; }
            .method.get { background: #1e3a5f; color: #60a5fa; }
            .path { font-family: monospace; color: var(--muted); }
        </style>
    </head>
    <body>
        <div class="engine-card">
            <div class="engine-badge">AI Audio Engine v2.0</div>
            <h1>VibeVoice Engine</h1>
            <p class="subtitle">Zero-shot voice cloning demo</p>

            <label>Reference Voice (.wav / .mp3)</label>
            <input type="file" id="voiceFile" accept="audio/*">

            <label>Text to Synthesise</label>
            <textarea id="textInput" rows="3" placeholder="Enter text to speak in the cloned voice..."></textarea>

            <div style="display: flex; gap: 1rem; margin-bottom: 1.5rem;">
                <button class="btn-generate" id="btnFast" style="background: var(--border);">Fast (0.5B)</button>
                <button class="btn-generate" id="btnPremium">Premium (1.5B)</button>
            </div>
            
            <div id="status"></div>

            <div class="audio-result" id="audioResult">
                <label>Result</label>
                <audio id="audioPlayer" controls style="display: none;"></audio>
                <div style="display: flex; gap: 1rem; margin-top: 1rem;">
                    <button class="btn-generate" id="playBtn" style="background: var(--accent);">Play Audio</button>
                    <a id="downloadLink" class="btn-generate" style="flex: 1; text-align: center; text-decoration: none; background: var(--success);">Download</a>
                </div>
            </div>

            <div class="endpoints">
                <div class="endpoint-row"><span class="method post">POST</span><span class="path">/cloner/generate</span></div>
                <div class="endpoint-row"><span class="method post">POST</span><span class="path">/podcast/build</span></div>
                <div class="endpoint-row"><span class="method ws">WS</span><span class="path">/ws/realtime</span></div>
                <div class="endpoint-row"><span class="method get">GET</span><span class="path">/health</span></div>
            </div>
        </div>

        <script>
            const status = document.getElementById('status');
            const audioPlayer = document.getElementById('audioPlayer');
            const audioResult = document.getElementById('audioResult');
            const downloadLink = document.getElementById('downloadLink');
            const playBtn = document.getElementById('playBtn');

            const generate = async (tier) => {
                const file = document.getElementById('voiceFile').files[0];
                const text = document.getElementById('textInput').value;
                if (!file || !text) { alert('Select a voice file and enter text'); return; }

                status.innerText = `Calling ${tier.toUpperCase()} engine... this may take 30-60s.`;
                document.getElementById('btnFast').disabled = true;
                document.getElementById('btnPremium').disabled = true;

                const fd = new FormData();
                fd.append('text', text);
                fd.append('voice', file);
                fd.append('tier', tier);

                try {
                    const res = await fetch('/cloner/generate', { method: 'POST', body: fd });
                    if (!res.ok) {
                        const errText = await res.text();
                        throw new Error(errText || 'Connection lost - check RunPod logs.');
                    }

                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    audioPlayer.src = url;
                    downloadLink.href = url;
                    downloadLink.download = `clone_${tier}_${Date.now()}.wav`;
                    audioResult.classList.add('show');
                    status.innerText = `[${tier.toUpperCase()}] Generation Complete!`;
                    
                    // Auto-play is often blocked by browsers, but we set the player ready
                    audioPlayer.load();
                } catch (e) {
                    status.innerText = '⚠️ ' + e.message;
                    console.error(e);
                } finally {
                    document.getElementById('btnFast').disabled = false;
                    document.getElementById('btnPremium').disabled = false;
                }
            };

            playBtn.onclick = () => {
                if (audioPlayer.src) audioPlayer.play();
            };

            document.getElementById('btnFast').onclick = () => generate('fast');
            document.getElementById('btnPremium').onclick = () => generate('premium');
        </script>
    </body>
    </html>
    """


# ═══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))

    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=False,
        log_level="info",
        ws_max_size=16 * 1024 * 1024,  # 16MB max WebSocket message (for audio)
    )
