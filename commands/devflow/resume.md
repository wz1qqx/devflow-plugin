---
name: devflow:resume
description: Restore session state and show current status
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<objective>
Restore worktree state, active tasks, and pending items from .dev.yaml and state files.
</objective>

<execution_context>
@../../skills/my-dev/workflows/resume.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the resume workflow from @../../skills/my-dev/workflows/resume.md end-to-end.
Load project config via: `node "$DEVFLOW_BIN" init resume`
</process>
