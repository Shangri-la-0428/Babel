#!/bin/bash
# BABEL — Quick Start
# Usage: ./start.sh

set -e

cd "$(dirname "$0")"

# Backend
echo "[BABEL] Starting backend..."
cd backend
if [ ! -d .venv ]; then
  python3 -m venv .venv
  source .venv/bin/activate
  pip install -e . -q
else
  source .venv/bin/activate
fi
uvicorn babel.api:app --port 8000 &
BACKEND_PID=$!
cd ..

# Frontend
echo "[BABEL] Starting frontend..."
cd frontend
if [ ! -d node_modules ]; then
  npm install --silent
fi
npx next dev --port 3000 &
FRONTEND_PID=$!
cd ..

echo ""
echo "[BABEL] Ready"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8000/docs"
echo ""
echo "  First time? Click Settings in the UI to configure your LLM API key."
echo "  Settings are saved in your browser — only need to set once."
echo ""
echo "Press Ctrl+C to stop."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
