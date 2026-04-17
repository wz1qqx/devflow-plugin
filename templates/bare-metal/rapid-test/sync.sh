#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE="$(cd "$SCRIPT_DIR/../.." && pwd)"

PROFILE="default"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --*) echo "Unknown option: $arg"; exit 1 ;;
    *) PROFILE="$arg" ;;
  esac
done

ENV_FILE="$SCRIPT_DIR/$PROFILE.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: profile not found: $ENV_FILE"
  echo "Available profiles:"
  ls "$SCRIPT_DIR"/*.env 2>/dev/null | xargs -I{} basename {} .env | sed 's/^/  /'
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [ -z "${RAPID_HOST:-}" ]; then
  echo "ERROR: RAPID_HOST is required in $ENV_FILE"
  exit 1
fi
if [ -z "${RAPID_CODE_DIR:-}" ]; then
  echo "ERROR: RAPID_CODE_DIR is required in $ENV_FILE"
  exit 1
fi
if [ -z "${RAPID_SYNC_PATHS:-}" ]; then
  echo "ERROR: RAPID_SYNC_PATHS is empty in $ENV_FILE"
  echo "Set it to a space-separated list of relative paths from workspace root."
  exit 1
fi

echo "==> devteam bare-metal sync"
echo "    profile=$PROFILE host=$RAPID_HOST code_dir=$RAPID_CODE_DIR"
[ "$DRY_RUN" = "1" ] && echo "    (dry-run mode)"

RSYNC_ARGS=(-az --relative)
if [ "$DRY_RUN" = "1" ]; then
  RSYNC_ARGS+=(--dry-run)
fi

copied=0
for rel in $RAPID_SYNC_PATHS; do
  if [ ! -e "$WORKSPACE/$rel" ]; then
    echo "  SKIP (missing): $rel"
    continue
  fi
  echo "  sync: $rel"
  (
    cd "$WORKSPACE"
    rsync "${RSYNC_ARGS[@]}" "$rel" "$RAPID_HOST:$RAPID_CODE_DIR/"
  )
  copied=$((copied + 1))
done

echo "==> done. synced entries: $copied"
