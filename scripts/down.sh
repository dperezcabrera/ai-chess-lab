#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .run/server.pid ] && kill "$(cat .run/server.pid)" 2>/dev/null; then
  echo "stopped, pid $(cat .run/server.pid)"
else
  echo "not running"
fi
rm -f .run/server.pid
