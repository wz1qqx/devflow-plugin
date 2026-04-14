---
name: devteam:clean
description: Cleanup resources — worktrees, images, K8s resources
argument-hint: "[--dry-run]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<objective>
Scan for and optionally remove orphan worktrees, stale container images, and stale K8s pods.
</objective>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover CLI tool and load config:
```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devteam/devteam/*/lib/devteam.cjs 2>/dev/null | head -1)
INIT=$(node "$DEVFLOW_BIN" init clean)
```

If `$INIT` contains `"feature": null` and `"available_features"`, prompt the user to select a feature with AskUserQuestion, then re-run: `INIT=$(node "$DEVFLOW_BIN" init clean --feature $SELECTED)`

**Step 2**: Execute:
```bash
DRY_RUN=$(echo "$ARGUMENTS" | grep -q '\-\-dry-run' && echo true || echo false)
SSH=$(echo "$INIT" | jq -r '.cluster.ssh')
NAMESPACE=$(echo "$INIT" | jq -r '.cluster.namespace')
REGISTRY=$(echo "$INIT" | jq -r '.build_server.registry // empty')
# Known worktrees = all dev_worktree paths across all features
KNOWN_WORKTREES=$(echo "$INIT" | jq -r '.all_features | to_entries[] | .value.scope | to_entries[] | .value.dev_worktree // empty')
# Known tags = all build_history_tags across all features
KNOWN_TAGS=$(echo "$INIT" | jq -r '.all_features | to_entries[] | .value.build_history_tags[]')
```

**Orphan worktrees**: scan parent directories of `$KNOWN_WORKTREES`; flag directories that exist on disk but are NOT in `$KNOWN_WORKTREES`.

**Stale images** (if `$REGISTRY` set): list images in registry; flag tags not in `$KNOWN_TAGS` and older than 30 days.

**Stale pods**:
```bash
$SSH "kubectl get pods -n $NAMESPACE --field-selector=status.phase!=Running,status.phase!=Pending -o name"
```
Flag pods in Error/CrashLoopBackOff state.

If `$DRY_RUN == true`: report only. Otherwise use AskUserQuestion to confirm each category before cleanup.
</process>
