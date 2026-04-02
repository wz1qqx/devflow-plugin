#!/bin/bash
# devflow plugin setup script
# Creates symlinks so that ~/.claude/my-dev points to the plugin's skill directory

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILL_ROOT="$PLUGIN_ROOT/skills/my-dev"
COMMANDS_SRC="$PLUGIN_ROOT/commands/devflow"
HOOKS_SRC="$PLUGIN_ROOT/hooks"

TARGET_SKILL="$HOME/.claude/my-dev"
TARGET_COMMANDS="$HOME/.claude/commands/devflow"
TARGET_HOOKS_DIR="$HOME/.claude/hooks"

echo "=== devflow plugin setup ==="
echo "Plugin root: $PLUGIN_ROOT"
echo ""

# --- 1. Skill symlink: ~/.claude/my-dev → plugin skills/my-dev ---
if [ -L "$TARGET_SKILL" ]; then
  CURRENT=$(readlink "$TARGET_SKILL")
  if [ "$CURRENT" = "$SKILL_ROOT" ]; then
    echo "[OK] ~/.claude/my-dev already points to plugin"
  else
    echo "[UPDATE] Updating symlink: $CURRENT → $SKILL_ROOT"
    ln -sfn "$SKILL_ROOT" "$TARGET_SKILL"
  fi
elif [ -e "$TARGET_SKILL" ]; then
  BACKUP="$TARGET_SKILL.bak.$(date +%s)"
  echo "[BACKUP] Existing ~/.claude/my-dev → $BACKUP"
  mv "$TARGET_SKILL" "$BACKUP"
  ln -sfn "$SKILL_ROOT" "$TARGET_SKILL"
  echo "[OK] Symlink created: ~/.claude/my-dev → $SKILL_ROOT"
else
  mkdir -p "$(dirname "$TARGET_SKILL")"
  ln -sfn "$SKILL_ROOT" "$TARGET_SKILL"
  echo "[OK] Symlink created: ~/.claude/my-dev → $SKILL_ROOT"
fi

# --- 2. Commands symlink: ~/.claude/commands/devflow → plugin commands/devflow ---
if [ -L "$TARGET_COMMANDS" ]; then
  CURRENT=$(readlink "$TARGET_COMMANDS")
  if [ "$CURRENT" = "$COMMANDS_SRC" ]; then
    echo "[OK] ~/.claude/commands/devflow already points to plugin"
  else
    echo "[UPDATE] Updating symlink: $CURRENT → $COMMANDS_SRC"
    ln -sfn "$COMMANDS_SRC" "$TARGET_COMMANDS"
  fi
elif [ -e "$TARGET_COMMANDS" ]; then
  BACKUP="$TARGET_COMMANDS.bak.$(date +%s)"
  echo "[BACKUP] Existing commands dir → $BACKUP"
  mv "$TARGET_COMMANDS" "$BACKUP"
  ln -sfn "$COMMANDS_SRC" "$TARGET_COMMANDS"
  echo "[OK] Symlink created: ~/.claude/commands/devflow → $COMMANDS_SRC"
else
  mkdir -p "$(dirname "$TARGET_COMMANDS")"
  ln -sfn "$COMMANDS_SRC" "$TARGET_COMMANDS"
  echo "[OK] Symlink created: ~/.claude/commands/devflow → $COMMANDS_SRC"
fi

# --- 3. Hook files: copy to ~/.claude/hooks/ ---
mkdir -p "$TARGET_HOOKS_DIR"
for hook_file in "$HOOKS_SRC"/*.js; do
  [ -f "$hook_file" ] || continue
  BASENAME=$(basename "$hook_file")
  if [ -f "$TARGET_HOOKS_DIR/$BASENAME" ] && diff -q "$hook_file" "$TARGET_HOOKS_DIR/$BASENAME" > /dev/null 2>&1; then
    echo "[OK] Hook $BASENAME already up to date"
  else
    cp "$hook_file" "$TARGET_HOOKS_DIR/$BASENAME"
    echo "[OK] Hook $BASENAME installed"
  fi
done

# --- 4. Verify prerequisites ---
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

if command -v jq &> /dev/null; then
  echo "[OK] jq found"
else
  echo "[WARN] jq not found — required for JSON parsing in workflows"
fi

# --- 5. Verify tool is callable ---
if [ -f "$SKILL_ROOT/bin/my-dev-tools.cjs" ]; then
  TEST_OUTPUT=$(node "$SKILL_ROOT/bin/my-dev-tools.cjs" features list 2>&1 || true)
  if echo "$TEST_OUTPUT" | grep -q "error\|Error\|Cannot find"; then
    echo "[INFO] CLI tools accessible (no workspace configured yet — expected for fresh install)"
  else
    echo "[OK] CLI tools working"
  fi
else
  echo "[ERROR] my-dev-tools.cjs not found at $SKILL_ROOT/bin/"
  exit 1
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. cd <your-project-directory>"
echo "  2. Run /devflow:init to initialize workspace (.dev.yaml)"
echo "  3. Run /devflow:init feature <name> to create your first feature"
echo "  4. Run /devflow:next to see what to do next"
