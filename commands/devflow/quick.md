---
name: devflow:quick
description: Execute ad-hoc task with atomic commits — skip full pipeline
argument-hint: ""<description>" [--discuss] [--research]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<objective>
Execute a small task (max 3 tasks) with atomic commits, bypassing the full spec/plan pipeline.
</objective>

<execution_context>
@../../skills/my-dev/quick.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover CLI tool and load config:
```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)
INIT=$(node "$DEVFLOW_BIN" init quick)
```

**Step 2**: Read the skill file and execute it end-to-end:
```bash
SKILL_FILE=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/quick.md 2>/dev/null | head -1)
```
Read `$SKILL_FILE` for the full process, then follow it step by step.
</process>
