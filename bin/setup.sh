#!/bin/bash
# devflow plugin — local development helper
#
# For marketplace users: no setup needed. Install via:
#   claude plugin marketplace add wz1qqx/devflow-plugin
#   claude plugin install devflow@devflow
#
# This script is ONLY for local development:
#   - Verifies prerequisites (Node.js, python3)
#   - Tests CLI tools are callable
#   - Does NOT create symlinks (marketplace handles discovery)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILL_ROOT="$PLUGIN_ROOT/skills/my-dev"

echo "=== devflow development check ==="
echo "Plugin root: $PLUGIN_ROOT"
echo ""

# --- 1. Check marketplace installation ---
MARKETPLACE_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1 || true)
if [ -n "$MARKETPLACE_BIN" ]; then
  echo "[OK] Marketplace install detected: $(dirname "$(dirname "$(dirname "$(dirname "$MARKETPLACE_BIN")")")")"
else
  echo "[INFO] No marketplace install found. For production use:"
  echo "       claude plugin marketplace add wz1qqx/devflow-plugin"
  echo "       claude plugin install devflow@devflow"
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
if [ -f "$SKILL_ROOT/bin/my-dev-tools.cjs" ]; then
  if node "$SKILL_ROOT/bin/my-dev-tools.cjs" features list > /dev/null 2>&1; then
    echo "[OK] CLI tools working (workspace detected)"
  else
    echo "[OK] CLI tools callable (no workspace configured yet — run /devflow:init)"
  fi
else
  echo "[ERROR] my-dev-tools.cjs not found at $SKILL_ROOT/bin/"
  exit 1
fi

# --- 4. Check for legacy symlinks ---
echo ""
LEGACY=false
[ -L "$HOME/.claude/my-dev" ] && echo "[LEGACY] ~/.claude/my-dev symlink exists (can be removed)" && LEGACY=true
[ -L "$HOME/.claude/commands/devflow" ] && echo "[LEGACY] ~/.claude/commands/devflow symlink exists (can be removed)" && LEGACY=true
[ -L "$HOME/.claude/hooks/my-dev-context-monitor.js" ] && echo "[LEGACY] ~/.claude/hooks/my-dev-context-monitor.js symlink exists (can be removed)" && LEGACY=true
[ -L "$HOME/.claude/hooks/devflow-persistent.js" ] && echo "[LEGACY] ~/.claude/hooks/devflow-persistent.js symlink exists (can be removed)" && LEGACY=true
[ -L "$HOME/.claude/hooks/my-dev-statusline.js" ] && echo "[LEGACY] ~/.claude/hooks/my-dev-statusline.js symlink exists (can be removed)" && LEGACY=true
if [ "$LEGACY" = false ]; then
  echo "[OK] No legacy symlinks found"
fi

echo ""
echo "=== Check complete ==="
echo ""
echo "Next steps:"
echo "  1. cd <your-project-directory>"
echo "  2. Run /devflow:init to initialize workspace (.dev.yaml)"
echo "  3. Run /devflow:init feature <name> to create your first feature"
echo "  4. Run /devflow:next to see what to do next"
