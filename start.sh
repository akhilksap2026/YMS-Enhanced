#!/usr/bin/env bash
# YMS Enhanced - single-command local start (Linux/macOS). Usage: ./start.sh   (PORT=8080 by default)
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8080}"; OCR_PORT="${OCR_PORT:-8001}"
command -v node >/dev/null || { echo "Node.js 20+ is required: https://nodejs.org"; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || { echo "Node.js 20+ required (found $(node -v))"; exit 1; }
PY="$(command -v python3 || command -v python || true)"
if [ ! -d services/core/node_modules ]; then echo "[1/3] Installing core dependencies..."; (cd services/core && npm ci --no-audit --no-fund); fi
if [ ! -f apps/web/dist/index.html ]; then echo "[2/3] Building web app..."; (cd apps/web && npm ci --no-audit --no-fund && npx vite build); fi
OCR_PID=""
if [ -n "$PY" ] && "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)'; then
  if [ ! -x services/ocr/.venv/bin/uvicorn ]; then echo "[3/3] Setting up OCR (Python venv)..."; "$PY" -m venv services/ocr/.venv && services/ocr/.venv/bin/pip install -q -r services/ocr/requirements.txt; fi
  (cd services/ocr && exec .venv/bin/uvicorn main:app --host 127.0.0.1 --port "$OCR_PORT" > ../../ocr.log 2>&1) & OCR_PID=$!
  echo "OCR service starting on :$OCR_PORT (log: ocr.log)"
else echo "WARNING: Python 3.10+ not found - OCR disabled; gate check-in still works with manual entry."; fi
trap '[ -n "$OCR_PID" ] && kill $OCR_PID 2>/dev/null || true' EXIT INT TERM
echo "Open http://localhost:$PORT   (demo login: tenant.admin@ksap.example / Ymsnow!2026)"
cd services/core && PORT="$PORT" OCR_URL="http://127.0.0.1:$OCR_PORT" npx tsx src/server.ts
