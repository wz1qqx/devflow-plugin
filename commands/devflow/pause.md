---
name: devflow:pause
description: Save session state for later resume - writes HANDOFF.json and updates STATE.md
argument-hint: ""
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---
<objective>
Capture current session state into HANDOFF.json and STATE.md so a future session can resume with zero context loss. Optionally sink valuable knowledge to Obsidian.
</objective>

<execution_context>
@~/.claude/my-dev/workflows/pause.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the pause workflow from @~/.claude/my-dev/workflows/pause.md end-to-end.
Load project config via: `node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init resume`
</process>
