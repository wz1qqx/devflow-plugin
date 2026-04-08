---
name: devflow:log
description: Quick checkpoint — save progress snapshot to devlog
argument-hint: "[message]"
allowed-tools:
  - Read
  - Write
  - Bash
---
<objective>
Record a quick checkpoint in the devlog.
</objective>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover CLI tool and load config:
```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)
INIT=$(node "$DEVFLOW_BIN" init log)
```

**Step 2**: Execute:
Run: node $DEVFLOW_BIN checkpoint --action $ARGUMENTS
</process>
