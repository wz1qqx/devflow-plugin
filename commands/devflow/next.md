---
name: devflow:next
description: Auto-detect project state and suggest the next workflow step
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<objective>
Detect current project state from .dev.yaml, STATE.md, and .dev/features/ artifacts, then automatically route to the next logical step in the development lifecycle.
</objective>

<execution_context>
@~/.claude/my-dev/workflows/next.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the next workflow from @~/.claude/my-dev/workflows/next.md end-to-end.
Load project config via: `node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init next`
</process>
