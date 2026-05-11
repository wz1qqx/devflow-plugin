---
name: devteam:workspace
description: Clean workspace skeleton — create the new .devteam layout without legacy assumptions
argument-hint: "scaffold [--root <path>] [--name <name>] [--force] [--clean-legacy]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---
<objective>
Create a clean devteam workspace skeleton with config, recipes, wiki, skills, runs, and profile placeholders.
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
Run `node \"$DEVTEAM_BIN\" workspace scaffold $ARGUMENTS`. Display created/skipped files, cleaned legacy metadata, and next_action. Use --force only when intentionally replacing an existing skeleton config; use --clean-legacy only when intentionally removing old migration-only metadata. This command does not choose concrete repos, branches, remote venvs, image tags, or cluster targets.
</process>
