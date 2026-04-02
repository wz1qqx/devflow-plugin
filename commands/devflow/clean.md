---
name: devflow:clean
description: Cleanup resources - worktrees, images, K8s resources
argument-hint: "[--dry-run]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - AskUserQuestion
---
<objective>
Clean up stale resources: orphaned worktrees, old container images, dangling K8s resources. Supports dry-run mode.
</objective>

<execution_context>
@~/.claude/my-dev/workflows/clean.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the clean workflow from @~/.claude/my-dev/workflows/clean.md end-to-end.
Load project config via: `node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init clean`
</process>
