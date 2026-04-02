---
name: devflow:discuss
description: Lock implementation decisions before planning — surface gray areas and capture user choices
argument-hint: "<feature>"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - AskUserQuestion
---
<objective>
Surface gray areas in a feature spec, ask the user to decide, and lock those decisions for the planner.
</objective>

<execution_context>
@../../skills/my-dev/workflows/discuss.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the discuss workflow from @../../skills/my-dev/workflows/discuss.md end-to-end.
Load project config via: `node "$DEVFLOW_BIN" init discuss`
</process>
