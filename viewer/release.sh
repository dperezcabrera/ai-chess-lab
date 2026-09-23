#!/usr/bin/env bash
# Publishes a tournament as it stood after round N into the site repository and commits it there.
# Usage: viewer/release.sh tournaments/<id>.json <round> [site repository, default ../ai-chess-battle]
set -euo pipefail
file=$1
round=$2
site=${3:-../ai-chess-battle}
.venv/bin/python viewer/build.py "$file" --rounds "$round" --human-name "${HUMAN_NAME:-David}" --out "$site"
git -C "$site" add -A
git -C "$site" commit -q -m "Release round $round"
git -C "$site" log --oneline -1
