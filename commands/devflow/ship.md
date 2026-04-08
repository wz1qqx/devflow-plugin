---
name: devflow:ship
description: Strategy-driven shipping — docker, k8s, or ci-cd with rollback plan
argument-hint: "[tag] [--strategy docker|k8s|ci-cd] [--rollback]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<objective>
Build, deploy, and verify using the configured shipping strategy. Includes pre-ship checklist and rollback capability.
</objective>

<execution_context>
@../../skills/my-dev/ship.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover CLI tool and load config:
```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)
INIT=$(node "$DEVFLOW_BIN" init ship)
```

**Step 2**: Read the skill file and execute it end-to-end:
```bash
SKILL_FILE=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/ship.md 2>/dev/null | head -1)
```
Read `$SKILL_FILE` for the full process, then follow it step by step.
</process>
