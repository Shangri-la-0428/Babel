#!/bin/bash
# BABEL — Quick Start
# Usage: ./start.sh

set -e

cd "$(dirname "$0")"

# Kill previous instances
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:8000 | xargs kill -9 2>/dev/null || true

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

sleep 3
open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null || true

echo ""
echo "[BABEL] Running at http://localhost:3000"
echo "Press Ctrl+C to stop."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
