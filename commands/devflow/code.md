---
name: devflow:code
description: Structured coding workflow - spec/plan/exec/review pipeline
argument-hint: "<feature> [--spec|--plan|--exec|--review|--status]"
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
Drive a feature through the structured coding pipeline: specification, planning, execution, and review. Dispatches to the appropriate sub-workflow based on the provided flag.
</objective>

<execution_context>
@~/.claude/my-dev/workflows/code.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the code workflow from @~/.claude/my-dev/workflows/code.md end-to-end.
Load project config via: `node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init code`

Parse the flag from arguments and dispatch accordingly:
- `--spec`   → Execute @~/.claude/my-dev/workflows/code-spec.md (gather requirements, write spec)
- `--plan`   → Execute @~/.claude/my-dev/workflows/code-plan.md (break spec into implementation plan)
- `--exec`   → Execute @~/.claude/my-dev/workflows/code-exec.md (implement plan with TDD)
- `--review` → Execute @~/.claude/my-dev/workflows/code-review.md (code review and quality checks)
- `--status` → Show current pipeline stage and pending items inline (no sub-workflow)
- No flag    → Auto-detect current stage from .dev.yaml state and resume from there
</process>
