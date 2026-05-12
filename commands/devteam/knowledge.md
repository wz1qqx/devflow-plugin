---
name: devteam:knowledge
description: Knowledge operations — list/search/lint/capture recipes, wiki, and skills
argument-hint: "<list|search|lint|capture> [query] [--root <path>] [--type <wiki|recipes|skills|all>] [--run <id>] [--apply]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---
<objective>
Manage the lightweight .devteam knowledge layer: recipes, wiki notes, reusable skills, and run-to-knowledge capture drafts.
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
Run `node "$DEVTEAM_BIN" knowledge $ARGUMENTS`. list and search are read-only and cover .devteam/wiki, .devteam/recipes, and .devteam/skills. lint checks missing knowledge dirs, overlong markdown, wiki index coverage, and dead wikilinks. capture reads a run and creates a draft by default; only write it with --apply, and use --to wiki or --to recipes to choose the target.
</process>
