---
name: devflow:discuss
description: Lock implementation decisions before planning — surface gray areas and capture user choices
argument-hint: "<feature>"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<objective>
Identify gray areas in a feature's implementation, let the user make decisions, and lock them in context.md. This feeds directly into the planner — decisions become non-negotiable constraints.
</objective>

<execution_context>
@~/.claude/my-dev/workflows/discuss.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the discuss workflow from @~/.claude/my-dev/workflows/discuss.md end-to-end.
Load project config via: `node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init code`
</process>
