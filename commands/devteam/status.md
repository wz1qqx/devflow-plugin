---
name: devteam:status
description: Latest run status — one-screen workspace/run overview
argument-hint: "[--root <path>] [--set <workspace-set>] [--run <id>] [--json]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<objective>
Display the latest `.devteam/runs/<id>/` status, including workspace state, run evidence, gates, publish plan, and next actions.
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
INIT=$(node "$DEVTEAM_BIN" init status)
```

If `$INIT` contains `"feature": null` and `"available_features"`, prompt the user to select a feature with AskUserQuestion, then re-run: `INIT=$(node "$DEVTEAM_BIN" init status --feature $SELECTED)`

**Step 2**: Execute:
Run `node \"$DEVTEAM_BIN\" status $ARGUMENTS`.

This is a shortcut for `session status`: if `--run` is omitted, it reads the latest run whose session metadata still matches current `.devteam/config.yaml`, skipping malformed or deleted-track history. Pass `--set <workspace-set>` to choose the latest readable run for one track. By default it prints compact text for daily use. Pass `--json` to print the full structured payload. Display `phase`, latest evidence, workspace totals, sync/image/deploy/deploy-verify/publish gates, publish-after-validation plan, and `next_actions`.
</process>
