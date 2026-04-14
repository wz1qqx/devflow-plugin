---
name: devteam:knowledge
description: Wiki operations — search, lint, list
argument-hint: "<search|lint|list> [query]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---
<objective>
Manage the wiki knowledge base — search for answers, run health checks, or list pages.
</objective>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover CLI tool and load config:
```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devteam/devteam/*/lib/devteam.cjs 2>/dev/null | head -1)
INIT=$(node "$DEVFLOW_BIN" init knowledge)
```

If `$INIT` contains `"feature": null` and `"available_features"`, prompt the user to select a feature with AskUserQuestion, then re-run: `INIT=$(node "$DEVFLOW_BIN" init knowledge --feature $SELECTED)`

**Step 2**: Execute:
```bash
WIKI_PAGES=$(echo "$INIT" | jq -c '.knowledge_notes')   # [{name, path}, ...]
WIKI_DIR=$(echo "$INIT" | jq -r '.wiki_dir // empty')
```

Parse action:
- **SEARCH `<query>`**: filter `$WIKI_PAGES` by name/keyword match, Read matching `.path` files, synthesize answer.
- **LIST**: print `$WIKI_PAGES` as a table (name, path).
- **LINT**: for each page in `$WIKI_PAGES`, Read the file and check: over-long (>400 lines), stale (last modified >90 days), dead wiki links (`[[PageName]]` where `PageName` not in `$WIKI_PAGES[*].name`), orphans (no other page links to it).
</process>
