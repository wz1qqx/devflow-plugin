---
name: devflow:cluster
description: Manage Kubernetes clusters - add, use, list
argument-hint: "<add|use|list> [name]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - AskUserQuestion
---
<objective>
Manage cluster profiles in .dev.yaml. Add new clusters, switch active cluster, or list available ones.
</objective>

<execution_context>
@../../skills/my-dev/workflows/cluster.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the cluster workflow from @../../skills/my-dev/workflows/cluster.md end-to-end.
Load project config via: `node "$DEVFLOW_BIN" init cluster`
</process>
