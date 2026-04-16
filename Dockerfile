# ─────────────────────────────────────────────────────────────────────────────
# VibeVoice AI Audio Engine — Production Dockerfile
# ─────────────────────────────────────────────────────────────────────────────
# Base: NVIDIA PyTorch 25.04 (CUDA 12.6+, cuDNN 9, PyTorch 2.6+)
# Pre-bakes VibeVoice models + voice presets to eliminate cold-start on RunPod
#
# Build:   docker build -t vibevoice-engine .
# Run:     docker run --gpus all -p 8000:8000 --env-file .env vibevoice-engine
# ─────────────────────────────────────────────────────────────────────────────

FROM nvcr.io/nvidia/pytorch:25.04-py3

WORKDIR /app

# ── System Dependencies ────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    libsox-dev \
    curl \
    git \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── Python Dependencies ───────────────────────────────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Flash Attention (compiled for Ampere+ / CUDA 12.6) ────────────────────
RUN pip install --no-cache-dir flash-attn --no-build-isolation

# ── VibeVoice (editable install from official repo) ───────────────────────
RUN git clone https://github.com/microsoft/VibeVoice.git /tmp/vibevoice \
    && cd /tmp/vibevoice \
    && pip install -e ".[streamingtts]" \
    && rm -rf /tmp/vibevoice/.git

# ── Pre-bake Models (eliminates RunPod cold-start) ────────────────────────
RUN python3 -c "\
from huggingface_hub import snapshot_download; \
snapshot_download('microsoft/VibeVoice-Realtime-0.5B', local_dir='/app/models/realtime-0.5b'); \
snapshot_download('microsoft/VibeVoice-1.5B', local_dir='/app/models/tts-1.5b')"

# ── Pre-bake Voice Presets ────────────────────────────────────────────────
RUN mkdir -p /app/voices/streaming_model && python3 -c "\
import urllib.request, os; \
base = 'https://raw.githubusercontent.com/microsoft/VibeVoice/main/demo/voices/streaming_model'; \
voices = [ \
    'de-Spk0_man.pt', 'de-Spk1_woman.pt', \
    'en-Carter_man.pt', 'en-Davis_man.pt', 'en-Emma_woman.pt', \
    'en-Frank_man.pt', 'en-Grace_woman.pt', 'en-Mike_man.pt', \
    'fr-Spk0_man.pt', 'fr-Spk1_woman.pt', \
    'in-Samuel_man.pt', \
    'it-Spk0_woman.pt', 'it-Spk1_man.pt', \
    'jp-Spk0_man.pt', 'jp-Spk1_woman.pt', \
    'kr-Spk0_woman.pt', 'kr-Spk1_man.pt', \
    'nl-Spk0_man.pt', 'nl-Spk1_woman.pt', \
    'pl-Spk0_man.pt', 'pl-Spk1_woman.pt', \
    'pt-Spk0_woman.pt', 'pt-Spk1_man.pt', \
    'sp-Spk0_woman.pt', 'sp-Spk1_man.pt', \
]; \
[urllib.request.urlretrieve(f'{base}/{v}', f'/app/voices/streaming_model/{v}') for v in voices]; \
print(f'Downloaded {len(voices)} voice presets')"

# ── Copy Application Code ────────────────────────────────────────────────
COPY . .

# ── Build UI Dashboard ────────────────────────────────────────────────────
RUN cd UI && npm install && npm run build

# ── Environment Defaults ─────────────────────────────────────────────────
ENV TRANSFORMERS_OFFLINE=1 \
    HF_HUB_OFFLINE=1 \
    DEVICE=cuda \
    HOST=0.0.0.0 \
    PORT=8000 \
    NEXT_PUBLIC_VOICE_SERVER_URL="http://localhost:8000" \
    NEXT_PUBLIC_GPU_SERVER_URL="http://localhost:8000"

EXPOSE 8000 3000

# ── Start ─────────────────────────────────────────────────────────────────
RUN chmod +x start_pod.sh
CMD ["./start_pod.sh"]
