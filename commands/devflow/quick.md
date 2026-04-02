---
name: devflow:quick
description: Execute ad-hoc task with atomic commits — skip full spec/plan ceremony
argument-hint: "\"<description>\" [--discuss] [--research] [--full]"
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
Execute a small, ad-hoc task with GSD-style guarantees (atomic commits, state tracking) but without the full spec→plan→exec→review ceremony. Optionally add discussion, research, or verification.
</objective>

<execution_context>
@~/.claude/my-dev/workflows/quick.md
</execution_context>

<context>
$ARGUMENTS

Available flags (active only when literally present):
- `--discuss` — surface gray areas before planning
- `--research` — check Obsidian knowledge cache + research if needed
- `--full` — enable plan-checker verification + post-exec review
</context>

<process>
Execute the quick workflow from @~/.claude/my-dev/workflows/quick.md end-to-end.
Load project config via: `node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init quick`
</process>
