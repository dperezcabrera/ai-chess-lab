#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .run
if [ -f .run/server.pid ] && kill -0 "$(cat .run/server.pid)" 2>/dev/null; then
  echo "already running, pid $(cat .run/server.pid)"
  exit 0
fi
setsid nohup bash -ic "exec $PWD/scripts/run.sh" > .run/server.log 2>&1 < /dev/null &
echo $! > .run/server.pid
echo "started, pid $!, log .run/server.log"
