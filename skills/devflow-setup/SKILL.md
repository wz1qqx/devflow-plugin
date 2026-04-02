---
name: devflow-setup
description: >
  First-time setup for the devflow plugin. Creates necessary symlinks and verifies prerequisites.
  Use when: user says "setup devflow", "install devflow", "configure devflow",
  or when devflow commands fail because ~/.claude/my-dev doesn't exist.
argument-hint: "[--check]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - AskUserQuestion
---

# devflow Setup

First-time installation and configuration for the devflow plugin.

## Process

<step name="CHECK_STATUS">
Check if devflow is already set up.

```bash
if [ -L "$HOME/.claude/my-dev" ]; then
  LINK_TARGET=$(readlink "$HOME/.claude/my-dev")
  echo "Status: INSTALLED (symlink → $LINK_TARGET)"
elif [ -d "$HOME/.claude/my-dev" ]; then
  echo "Status: LEGACY_INSTALL (direct directory, not plugin-managed)"
else
  echo "Status: NOT_INSTALLED"
fi
```

If `$ARGUMENTS` contains `--check`, report status and exit.
</step>

<step name="FIND_PLUGIN_ROOT">
Locate the plugin root directory (where .claude-plugin/plugin.json lives).

The setup script is at `<plugin-root>/bin/setup.sh`. Find it:

```bash
# The SKILL.md that loaded us is inside the plugin
# Walk up from ~/.claude/my-dev (if symlink exists) or search plugins cache
PLUGIN_ROOT=""
if [ -L "$HOME/.claude/my-dev" ]; then
  SKILL_DIR=$(readlink "$HOME/.claude/my-dev")
  PLUGIN_ROOT=$(cd "$SKILL_DIR/../.." && pwd)
elif [ -d "$HOME/.claude/plugins" ]; then
  # Search in plugin cache
  PLUGIN_ROOT=$(find "$HOME/.claude/plugins/cache" -name "plugin.json" -path "*/devflow/*" -exec dirname {} \; 2>/dev/null | head -1)
  [ -n "$PLUGIN_ROOT" ] && PLUGIN_ROOT=$(cd "$PLUGIN_ROOT/.." && pwd)
fi

if [ -z "$PLUGIN_ROOT" ] || [ ! -f "$PLUGIN_ROOT/bin/setup.sh" ]; then
  echo "ERROR: Cannot locate devflow plugin root. Please run setup manually:"
  echo "  bash <path-to-devflow-plugin>/bin/setup.sh"
  exit 1
fi
```
</step>

<step name="RUN_SETUP">
Execute the setup script.

```bash
bash "$PLUGIN_ROOT/bin/setup.sh"
```

Report the output to the user.
</step>

<step name="INIT_WORKSPACE">
After setup, ask if the user wants to initialize a workspace.

Ask via AskUserQuestion:
- "要在当前目录初始化 devflow workspace 吗？"
  - "是，初始化 workspace" → run `/devflow:init`
  - "不，稍后再说" → done

If yes, chain to `/devflow:init`.
</step>
