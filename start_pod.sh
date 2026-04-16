#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# VibeVoice POD Startup Orchestrator
# ─────────────────────────────────────────────────────────────────────────────

echo "[Orchestrator] Starting VibeVoice Multi-Engine Architecture..."

# 1. Start AI Engine (FastAPI) in background
echo "[Orchestrator] Launching AI Backend (Port 8000)..."
cd /app
python3 main.py &
BACKEND_PID=$!

# 2. Start Dashboard (Next.js) in background
echo "[Orchestrator] Launching Dashboard (Port 3000)..."
cd /app/UI
# Use 'npm start' for production build, 'npm run dev' if volume-mounted
if [ -d ".next" ]; then
    npm start &
else
    npm run dev &
fi
FRONTEND_PID=$!

# 3. Wait/Monitor
echo "[Orchestrator] All systems operational."

trap "kill $BACKEND_PID $FRONTEND_PID" SIGINT SIGTERM
wait
