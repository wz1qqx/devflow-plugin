---
name: devflow:rollback
description: Rollback deployment to a previous image tag
argument-hint: "[tag]"
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---
<objective>
Roll back the current deployment to a previous image tag. Confirms before applying and updates .dev.yaml state.
</objective>

<execution_context>
@~/.claude/my-dev/workflows/rollback.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the rollback workflow from @~/.claude/my-dev/workflows/rollback.md end-to-end.
Load project config via: `node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init rollback`
</process>
