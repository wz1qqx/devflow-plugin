---
name: devflow:resume
description: Restore session state and show current status
argument-hint: ""
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<objective>
Resume a previous session by restoring worktree state, active tasks, and pending items from .dev.yaml and .omc state.
</objective>

<execution_context>
@~/.claude/my-dev/workflows/resume.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the resume workflow from @~/.claude/my-dev/workflows/resume.md end-to-end.
Load project config via: `node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init resume`
</process>
