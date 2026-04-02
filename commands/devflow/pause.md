---
name: devflow:pause
description: Save session state for later resume - writes HANDOFF.json and updates STATE.md
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---
<objective>
Capture the current session state into HANDOFF.json and STATE.md for zero-loss session handoff.
</objective>

<execution_context>
@../../skills/my-dev/workflows/pause.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the pause workflow from @../../skills/my-dev/workflows/pause.md end-to-end.
Load project config via: `node "$DEVFLOW_BIN" init pause`
</process>
