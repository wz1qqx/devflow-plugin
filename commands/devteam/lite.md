---
name: devteam:lite
description: Lite workspace migration — create .devteam config and compatibility files
argument-hint: "<migrate|assets|compat> [--root <path>] [--from <legacy-workspace>] [--to <new-workspace>] [--apply] [--force]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---
<objective>
Migrate legacy workspace.yaml + .dev/features metadata, supporting workspace assets, and legacy runtime compatibility files into the lightweight .devteam workspace model.
</objective>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover CLI tool and load config:
```bash
DEVTEAM_BIN="${HOME}/.claude/plugins/marketplaces/devteam/lib/devteam.cjs"
[ -f "$DEVTEAM_BIN" ] || DEVTEAM_BIN=$(ls ~/.claude/plugins/cache/devteam/devteam/*/lib/devteam.cjs 2>/dev/null | head -1)
[ -n "$DEVTEAM_BIN" ] || { echo "ERROR: devteam.cjs not found" >&2; exit 1; }
INIT=$(node "$DEVTEAM_BIN" init lite)
```

If `$INIT` contains `"feature": null` and `"available_features"`, prompt the user to select a feature with AskUserQuestion, then re-run: `INIT=$(node "$DEVTEAM_BIN" init lite --feature $SELECTED)`

**Step 2**: Execute:
Run `node \"$DEVTEAM_BIN\" lite $ARGUMENTS`. For migrate, confirm the output config path, workspace sets, worktree count, env profiles, and migrated knowledge recipe path. For assets, show copy plan first; only use --apply when the user explicitly asks to copy supporting files such as build.sh, scripts, deploy, guides, hooks, and Dockerfiles. For compat, generate the .dev.yaml projection needed by legacy build.sh; use --legacy-dev-yaml only to preserve old build_history/current_tag while keeping .devteam/config.yaml as source of truth.
</process>
