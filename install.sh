#!/bin/bash
# BABEL — Install
set -e

cd "$(dirname "$0")"
ROOT=$(pwd)

echo "[BABEL] Installing backend..."
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e . -q
cd ..

echo "[BABEL] Installing frontend..."
cd frontend
npm install --silent
cd ..

# Create global command
LINK="/usr/local/bin/babel"
if [ -w /usr/local/bin ]; then
  ln -sf "$ROOT/start.sh" "$LINK"
  echo "[BABEL] Installed 'babel' command."
else
  sudo ln -sf "$ROOT/start.sh" "$LINK"
  echo "[BABEL] Installed 'babel' command (used sudo)."
fi

echo ""
echo "[BABEL] Done! Type 'babel' anywhere to start."
echo "  Then open http://localhost:3000 and configure your API key in Settings."
