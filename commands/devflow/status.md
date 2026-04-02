---
name: devflow:status
description: Project overview - config, worktrees, deployments, pipeline stage
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<objective>
Display a comprehensive project overview including config, worktree states, active deployments, and pipeline stage.
</objective>

<execution_context>
@../../skills/my-dev/workflows/info.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the status workflow from @../../skills/my-dev/workflows/info.md end-to-end.
Load project config via: `node "$DEVFLOW_BIN" init status`
</process>
