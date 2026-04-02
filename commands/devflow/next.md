---
name: devflow:next
description: Auto-detect project state and suggest the next workflow step
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<objective>
Read project state and suggest the most logical next action based on current phase and artifacts.
</objective>

<execution_context>
@../../skills/my-dev/workflows/next.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the next workflow from @../../skills/my-dev/workflows/next.md end-to-end.
Load project config via: `node "$DEVFLOW_BIN" init next`
</process>
