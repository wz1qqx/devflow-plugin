---
name: devteam:env
description: Environment profiles — list, doctor, or refresh remote/k8s profiles
argument-hint: "<list|doctor|refresh> [--root <path>] [--profile <name>] [--remote] [--yes] [--run <id>]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<objective>
Inspect lightweight remote_dev and k8s environment profiles, and refresh vLLM editable remote venvs when explicitly requested.
</objective>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover the devteam CLI:
```bash
DEVTEAM_BIN="${HOME}/.claude/plugins/marketplaces/devteam/lib/devteam.cjs"
[ -f "$DEVTEAM_BIN" ] || DEVTEAM_BIN=$(ls ~/.claude/plugins/cache/devteam/devteam/*/lib/devteam.cjs 2>/dev/null | head -1)
[ -n "$DEVTEAM_BIN" ] || { echo "ERROR: devteam.cjs not found" >&2; exit 1; }
```

If no `--root` is provided, use the current workspace or nearest parent containing `.devteam/config.yaml`. Do not select a global active track; ask the user to choose a track or pass `--set <track>` when the command needs one.

**Step 2**: Execute:
Run `node "$DEVTEAM_BIN" env $ARGUMENTS`. For doctor, display local command checks and missing profile fields. --remote performs explicit read-only SSH checks. With doctor --remote --run <id>, append an env-doctor event to that run. For refresh, show the generated command unless --yes is present; only execute remote editable venv refresh with explicit --yes. With refresh --yes --run <id>, append an env-refresh event to that run.
</process>
