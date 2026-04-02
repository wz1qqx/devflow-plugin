---
name: devflow:log
description: Quick checkpoint - save progress snapshot to devlog
argument-hint: "[message]"
allowed-tools:
  - Read
  - Write
  - Bash
---
<objective>
Record a quick checkpoint in the devlog with current state, changes made, and an optional message.
</objective>

<execution_context>
@~/.claude/my-dev/workflows/log.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the log workflow from @~/.claude/my-dev/workflows/log.md end-to-end.
Load project config via: `node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init log`
</process>
