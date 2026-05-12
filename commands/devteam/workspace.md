---
name: devteam:workspace
description: Workspace management — scaffold .devteam layout and agent onboarding/context
argument-hint: "<scaffold|onboard|context> [--root <path>] [--name <name>] [--write] [--force] [--for codex|claude|human] [--text]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---
<objective>
Create a clean devteam workspace skeleton and generate/read the agent onboarding protocol for any .devteam workspace.
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
INIT=$(node "$DEVTEAM_BIN" init workspace)
```

If `$INIT` contains `"feature": null` and `"available_features"`, prompt the user to select a feature with AskUserQuestion, then re-run: `INIT=$(node "$DEVTEAM_BIN" init workspace --feature $SELECTED)`

**Step 2**: Execute:
Run `node "$DEVTEAM_BIN" workspace $ARGUMENTS`. For scaffold, display created/skipped files, cleaned legacy metadata, and next_action; use --force only when intentionally replacing an existing skeleton config and --clean-legacy only when intentionally removing old migration-only metadata. For onboard, render AGENTS.md, CLAUDE.md, and README.devteam.md from .devteam/config.yaml; dry-run by default, write only with --write, and overwrite drifted files only with --force. For context, print the dynamic agent context: workspace identity, track selection policy, active/parked/archived tracks, selected/default track, primary next action, and first commands. This command does not choose concrete repos, branches, remote venvs, image tags, or cluster targets.
</process>
