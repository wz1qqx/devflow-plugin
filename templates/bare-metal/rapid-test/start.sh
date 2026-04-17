#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

PROFILE="${1:-default}"
ACTION="${2:-}"

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

run_remote() {
  local cmd="$1"
  ssh "$RAPID_HOST" bash -lc "$(printf '%q' "$cmd")"
}

if [ "$ACTION" = "stop" ]; then
  if [ -z "${RAPID_STOP_CMD:-}" ]; then
    echo "ERROR: RAPID_STOP_CMD is empty in $ENV_FILE"
    exit 1
  fi
  echo "==> stopping service on $RAPID_HOST"
  run_remote "$RAPID_STOP_CMD"
  exit 0
fi

if [ "$ACTION" = "status" ]; then
  if [ -z "${RAPID_STATUS_CMD:-}" ]; then
    echo "ERROR: RAPID_STATUS_CMD is empty in $ENV_FILE"
    exit 1
  fi
  echo "==> status on $RAPID_HOST"
  run_remote "$RAPID_STATUS_CMD"
  exit 0
fi

CONFIG="${ACTION:-${RAPID_DEFAULT_CONFIG:-default}}"
if [ -z "${RAPID_START_CMD:-}" ]; then
  echo "ERROR: RAPID_START_CMD is empty in $ENV_FILE"
  echo "Set RAPID_START_CMD and include {config} placeholder."
  exit 1
fi

START_CMD="${RAPID_START_CMD//\{config\}/$CONFIG}"
echo "==> starting service on $RAPID_HOST (profile=$PROFILE config=$CONFIG)"
run_remote "$START_CMD"

if [ -n "${RAPID_SERVICE_URL:-}" ]; then
  echo "==> probing health: http://$RAPID_SERVICE_URL/health"
  for _ in $(seq 1 20); do
    code="$(curl -sS -m 3 -o /dev/null -w '%{http_code}' "http://$RAPID_SERVICE_URL/health" || true)"
    if [ "$code" = "200" ]; then
      echo "health: 200"
      exit 0
    fi
    sleep 2
  done
  echo "WARN: health check did not reach 200 in time"
fi
