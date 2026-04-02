---
name: devflow:diff
description: Show worktree changes across repositories
argument-hint: "[repo]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<objective>
Display a summary of uncommitted and staged changes across all worktrees (or a specific repo) managed by the project.
</objective>

<execution_context>
@../../skills/my-dev/workflows/info.md
</execution_context>

<context>
diff $ARGUMENTS
</context>

<process>
Execute the diff workflow from @../../skills/my-dev/workflows/info.md end-to-end.
Load project config via: `node "$DEVFLOW_BIN" init diff`
</process>
