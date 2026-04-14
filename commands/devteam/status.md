---
name: devteam:status
description: Project overview — team status, pipeline stage, deployments
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<objective>
Display a comprehensive project overview including config, worktree states, active deployments, and pipeline stage.
</objective>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover CLI tool and load config:
```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devteam/devteam/*/lib/devteam.cjs 2>/dev/null | head -1)
INIT=$(node "$DEVFLOW_BIN" init status)
```

If `$INIT` contains `"feature": null` and `"available_features"`, prompt the user to select a feature with AskUserQuestion, then re-run: `INIT=$(node "$DEVFLOW_BIN" init status --feature $SELECTED)`

**Step 2**: Extract and display:
```bash
FEATURE=$(echo "$INIT" | jq -r '.feature.name // "none"')
PHASE=$(echo "$INIT" | jq -r '.feature.phase // "init"')
CLUSTER=$(echo "$INIT" | jq -r '.cluster.name // "none"')
NAMESPACE=$(echo "$INIT" | jq -r '.cluster.namespace // "-"')
SAFETY=$(echo "$INIT" | jq -r '.cluster.safety // "-"')
CURRENT_TAG=$(echo "$INIT" | jq -r '.feature.current_tag // "none"')
```

Display as dashboard:
```
=== devteam status ===

Feature : $FEATURE  (phase: $PHASE, tag: $CURRENT_TAG)

Repos:
  (for each in $INIT.repos[])
  <repo>: <dev_worktree>  [+<commits_ahead> commits]  [uncommitted: yes/no]

Cluster : $CLUSTER  namespace=$NAMESPACE  safety=$SAFETY

Build History (last 3):
  (for each in $INIT.build_history[-3:])
  <tag>  <date>  <changes>

Wiki : $INIT.knowledge_notes | length pages indexed
```

No "team status" field — omit that section entirely.
</process>
