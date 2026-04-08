---
name: devflow:switch
description: Switch active feature context
argument-hint: "<feature-name>"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - AskUserQuestion
---
<objective>
Switch the active feature by updating defaults.active_feature in .dev.yaml.
</objective>

<execution_context>
@../../skills/my-dev/references/schema.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover CLI tool and load config:
```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)
INIT=$(node "$DEVFLOW_BIN" init switch)
```

**Step 2**: Execute:
List available features from $INIT. If target given, update .dev.yaml active_feature. Otherwise prompt user to select.
</process>
