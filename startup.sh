#!/usr/bin/env bash
# Unified entry point for the Fish Recovery voice-agent demo.
#   - Frees the portal port (default 47821) of any stale process
#   - Sets up the Python venv at agent/.venv on first run
#   - Installs Python + npm deps if missing
#   - Launches the Node portal AND the Python LiveKit agent worker in parallel
#   - Ctrl-C tears both down cleanly

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Load .env so PORT (and the rest) are visible to this script.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PORT="${PORT:-47821}"
VENV_DIR="$ROOT/agent/.venv"
PY_BIN="${PYTHON:-python3}"

# ----- pre-flight: free the portal port + kill stale agent workers ---------

if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
  if [ -n "$PIDS" ]; then
    echo "[startup] freeing port $PORT (killing PIDs: $PIDS)"
    # shellcheck disable=SC2086
    kill -9 $PIDS 2>/dev/null || true
  fi
fi

# The LiveKit agent worker doesn't bind a local port, so the port-free pass
# above can't see it. Kill any stale `python -m agent.main` workers from
# previous runs so they don't race the new one for LiveKit job dispatch.
# Match on `-m agent.main` rather than the python binary path, because macOS
# Python is invoked via .../Python.app/Contents/MacOS/Python (capital P).
if command -v pgrep >/dev/null 2>&1; then
  STALE_AGENTS="$(pgrep -f -- '-m agent.main' 2>/dev/null || true)"
  if [ -n "$STALE_AGENTS" ]; then
    echo "[startup] killing stale agent workers (PIDs: $STALE_AGENTS)"
    # shellcheck disable=SC2086
    kill -9 $STALE_AGENTS 2>/dev/null || true
  fi
fi

# LiveKit dev mode uses Python multiprocessing.spawn for worker subprocesses.
# When the parent dies (Ctrl-C, crash, or hot-reload), spawn children survive
# and get reparented to init (ppid=1). Each surviving child stays registered
# with LiveKit Cloud and races the fresh worker for job dispatch — so the
# user hears the same line repeated by different processes ("different
# voices"). Kill any such orphans before launching.
ORPHANS="$(ps -eo pid,ppid,command 2>/dev/null | awk '/multiprocessing\.(spawn|resource_tracker)/ && $2==1 {print $1}')"
if [ -n "$ORPHANS" ]; then
  echo "[startup] killing orphaned multiprocessing workers (PIDs: $ORPHANS)"
  # shellcheck disable=SC2086
  kill -9 $ORPHANS 2>/dev/null || true
fi

# ----- python venv + deps --------------------------------------------------

if [ ! -d "$VENV_DIR" ]; then
  echo "[startup] creating python venv at $VENV_DIR"
  "$PY_BIN" -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

if ! python -c "import livekit.agents, langgraph, langchain_google_genai" >/dev/null 2>&1; then
  echo "[startup] installing python dependencies (first run can take a few minutes)"
  pip install --upgrade pip >/dev/null
  pip install -r agent/requirements.txt
fi

# ----- node deps -----------------------------------------------------------

if [ ! -d node_modules ]; then
  echo "[startup] installing npm dependencies"
  npm install
fi

# ----- credential sanity check --------------------------------------------

missing=()
for var in LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET GOOGLE_API_KEY DEEPGRAM_API_KEY; do
  if [ -z "${!var:-}" ]; then
    missing+=("$var")
  fi
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "[startup] WARNING: missing env vars in .env: ${missing[*]}"
fi

# ----- launch both processes ----------------------------------------------

LOG_DIR="$ROOT/.logs"
mkdir -p "$LOG_DIR"

cleanup() {
  echo ""
  echo "[startup] shutting down..."
  if [ -n "${NODE_PID:-}" ]; then kill "$NODE_PID" 2>/dev/null || true; fi
  if [ -n "${AGENT_PID:-}" ]; then kill "$AGENT_PID" 2>/dev/null || true; fi
  wait 2>/dev/null || true
  echo "[startup] done."
  exit 0
}
trap cleanup INT TERM

echo "[startup] launching Node portal on :$PORT  -> $LOG_DIR/portal.log"
PORT="$PORT" npm run dev >"$LOG_DIR/portal.log" 2>&1 &
NODE_PID=$!

echo "[startup] launching Python LiveKit agent worker  -> $LOG_DIR/agent.log"
python -m agent.main dev >"$LOG_DIR/agent.log" 2>&1 &
AGENT_PID=$!

echo ""
echo "[startup] portal:  http://localhost:$PORT      (PID $NODE_PID)"
echo "[startup] agent:   livekit worker is up        (PID $AGENT_PID)"
echo "[startup] logs:    tail -f $LOG_DIR/portal.log $LOG_DIR/agent.log"
echo "[startup] press Ctrl-C to stop."

wait
