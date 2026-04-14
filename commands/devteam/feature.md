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

**Step 2**: Execute based on action:

**LIST / no action**:
```bash
node "$DEVFLOW_BIN" features list   # returns {features: [{name, description, phase, scope, active}]}
```
Display as table. Then use AskUserQuestion to let user pick a feature to activate.
```bash
node "$DEVFLOW_BIN" features switch <selected>
```
Confirm: "Feature '<selected>' is now active."

**DELETE**:
```bash
# Confirm with AskUserQuestion first
node "$DEVFLOW_BIN" features delete <name>
```

Note: `$INIT` (from `init workspace`) also has `available_features` — use it for the initial list display if CLI call fails.
</process>
