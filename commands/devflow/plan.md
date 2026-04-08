---
name: devflow:plan
description: Read-only analysis to dependency graph with vertical slices and acceptance criteria
argument-hint: "<feature>"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
---
<objective>
Decompose a feature spec into small, verifiable tasks with dependency ordering and wave-based grouping.
</objective>

<execution_context>
@../../skills/my-dev/plan.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover CLI tool and load config:
```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)
INIT=$(node "$DEVFLOW_BIN" init plan)
```

**Step 2**: Read the skill file and execute it end-to-end:
```bash
SKILL_FILE=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/plan.md 2>/dev/null | head -1)
```
Read `$SKILL_FILE` for the full process, then follow it step by step.
</process>
