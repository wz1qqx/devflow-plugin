---
name: devteam:feature
description: List features and select/delete — use at session start to pick active feature
argument-hint: "[list|delete] [name]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<objective>
Show all features with status, let user select one to bind as active, or delete a feature. When invoked without args, list features and prompt user to choose.
</objective>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover CLI tool and load config:
```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devteam/devteam/*/lib/devteam.cjs 2>/dev/null | head -1)
INIT=$(node "$DEVFLOW_BIN" init workspace)
```

If `$INIT` contains `"feature": null` and `"available_features"`, prompt the user to select a feature with AskUserQuestion, then re-run: `INIT=$(node "$DEVFLOW_BIN" init workspace --feature $SELECTED)`

**Step 2**: Execute:
1. Run CLI: `node "$DEVFLOW_BIN" features list` to get all features with phase/scope
2. Display features as a table: name, description, phase, scope
3. If action is `delete`: confirm with AskUserQuestion, then run `node "$DEVFLOW_BIN" features delete <name>`
4. If action is `list` or no action: use AskUserQuestion to let user pick a feature
5. Run `node "$DEVFLOW_BIN" features switch <selected>` to bind the selection
6. Show confirmation: "Feature '<name>' is now active"
</process>
