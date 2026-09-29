#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec env PORT="${PORT:-8000}" .venv/bin/ai-chess-lab
