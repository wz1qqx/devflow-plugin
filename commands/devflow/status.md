---
name: devflow:status
description: Project overview - config, worktrees, deployments, pipeline stage
argument-hint: ""
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<objective>
Display a comprehensive project overview: .dev.yaml config, worktree states, active deployments, current pipeline stage, and recent activity.
</objective>

<execution_context>
@~/.claude/my-dev/workflows/info.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the status section of the info workflow from @~/.claude/my-dev/workflows/info.md end-to-end.
Load project config via: `node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init status`
</process>
