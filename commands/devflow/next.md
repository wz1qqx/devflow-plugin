---
name: devflow:next
description: Auto-detect project state and suggest the next workflow step
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<objective>
Read project state and suggest the most logical next action based on current phase and artifacts.
</objective>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover CLI tool and load config:
```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)
INIT=$(node "$DEVFLOW_BIN" init next)
```

**Step 2**: Execute:
Read phase from $INIT. Route: spec->plan, plan->code, code->test, test->review, review->ship. Check for HANDOFF.json (resume). Check for failed review (re-code). Suggest command.
</process>
