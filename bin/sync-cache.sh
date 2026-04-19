#!/bin/bash
# Sync local devteam repo → Claude Code plugin cache + marketplaces
# Run after any local changes to make them effective immediately.
#
# Usage: bash bin/sync-cache.sh

set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(cat "$SRC/VERSION")"

RSYNC_OPTS=(-a --delete --exclude='.git' --exclude='.claude' --exclude='node_modules')

# 1. Versioned cache (used as fallback DEVTEAM_BIN path)
DST_CACHE="$HOME/.claude/plugins/cache/devteam/devteam/$VERSION"
mkdir -p "$DST_CACHE"
rsync "${RSYNC_OPTS[@]}" "$SRC/" "$DST_CACHE/"
echo "[OK] cache      $SRC → $DST_CACHE"

# 2. Marketplaces (what Claude Code actually reads for agent definitions)
DST_MKT="$HOME/.claude/plugins/marketplaces/devteam"
if [ -d "$DST_MKT" ]; then
  rsync "${RSYNC_OPTS[@]}" "$SRC/" "$DST_MKT/"
  echo "[OK] marketplaces $SRC → $DST_MKT"
else
  echo "[SKIP] marketplaces dir not found: $DST_MKT"
  echo "       Run: claude plugin install devteam@devteam  to create it"
fi
