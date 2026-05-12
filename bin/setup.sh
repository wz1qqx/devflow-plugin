#!/bin/bash
# devteam plugin — local development helper
#
# For marketplace users: no setup needed. Install via:
#   claude plugin marketplace add wz1qqx/devteam
#   claude plugin install devteam@devteam
#
# This script is ONLY for local development:
#   - Verifies prerequisites (Node.js, python3)
#   - Tests CLI tools are callable
#   - Does NOT create symlinks (marketplace handles discovery)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_ROOT="$PLUGIN_ROOT/lib"

echo "=== devteam development check ==="
echo "Plugin root: $PLUGIN_ROOT"
echo ""

# --- 1. Check marketplace installation ---
MARKETPLACE_BIN=$(ls ~/.claude/plugins/cache/devteam/devteam/*/lib/devteam.cjs 2>/dev/null | head -1 || true)
if [ -n "$MARKETPLACE_BIN" ]; then
  echo "[OK] Marketplace install detected: $(dirname "$(dirname "$MARKETPLACE_BIN")")"
else
  echo "[INFO] No marketplace install found. For production use:"
  echo "       claude plugin marketplace add wz1qqx/devteam"
  echo "       claude plugin install devteam@devteam"
fi

# --- 2. Verify prerequisites ---
echo ""
echo "=== Checking prerequisites ==="

if command -v node &> /dev/null; then
  NODE_VER=$(node --version)
  echo "[OK] Node.js $NODE_VER"
else
  echo "[WARN] Node.js not found — required for CLI tools"
fi

if command -v python3 &> /dev/null; then
  echo "[OK] python3 found"
else
  echo "[WARN] python3 not found — required for YAML parsing"
fi

# --- 3. Verify tool is callable ---
if [ -f "$CLI_ROOT/devteam.cjs" ]; then
  if node "$CLI_ROOT/devteam.cjs" workspace context --root "$PWD" --text > /dev/null 2>&1; then
    echo "[OK] CLI tools working (.devteam workspace detected)"
  else
    echo "[OK] CLI tools callable (no .devteam workspace configured here yet)"
  fi
else
  echo "[ERROR] devteam.cjs not found at $CLI_ROOT/"
  exit 1
fi

echo ""
echo "=== Check complete ==="
echo ""
echo "Next steps:"
echo "  1. cd <your-project-directory>"
echo "  2. Run /devteam workspace scaffold to create .devteam/config.yaml"
echo "  3. Run /devteam workspace onboard --write to create agent onboarding files"
echo "  4. Run /devteam track list --active-only to choose a track"
echo "  5. Optional: merge templates/statusline-settings.json into ~/.claude/settings.local.json"
