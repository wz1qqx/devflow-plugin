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
Manage the lightweight `.devteam` knowledge layer: recipes, wiki notes, reusable skills, and run-to-knowledge capture drafts.
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
INIT=$(node "$DEVTEAM_BIN" init knowledge)
```

If `$INIT` contains `"feature": null` and `"available_features"`, prompt the user to select a feature with AskUserQuestion, then re-run: `INIT=$(node "$DEVTEAM_BIN" init knowledge --feature $SELECTED)`

**Step 2**: Execute:
Run `node \"$DEVTEAM_BIN\" knowledge $ARGUMENTS`.

Supported operations:

- `knowledge list`: list `.devteam/wiki`, `.devteam/recipes`, and `.devteam/skills` markdown files.
- `knowledge search <query>`: search titles, paths, and content.
- `knowledge lint`: check missing knowledge dirs, overlong markdown, wiki index coverage, and dead wikilinks.
- `knowledge capture --run <id>`: render a draft note from a run. It is read-only by default; pass `--apply` to write it.

Use `--type wiki|recipes|skills|all` for list/search, and `--to wiki|recipes` for capture.
</process>
