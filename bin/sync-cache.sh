#!/bin/bash
# Sync local devteam repo → Claude Code plugin cache
# Run after any local changes to make them effective in new sessions.
#
# Usage: bash bin/sync-cache.sh

set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(cat "$SRC/VERSION")"
DST="$HOME/.claude/plugins/cache/devteam/devteam/$VERSION"

mkdir -p "$DST"
rsync -a --delete \
  --exclude='.git' \
  --exclude='.claude' \
  --exclude='node_modules' \
  "$SRC/" "$DST/"

echo "[OK] Synced $SRC → $DST"
