---
name: devflow:observe
description: Observability — deploy monitoring, query metrics, analyze performance
argument-hint: "[--setup|--monitor|--analyze|--query <promql>|--stop]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---
<objective>
Manage observability stack: deploy Prometheus monitoring, query live metrics, start threshold monitoring, cross-analyze metrics with bench results.
</objective>

<execution_context>
@~/.claude/my-dev/workflows/observe.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the observe workflow from @~/.claude/my-dev/workflows/observe.md end-to-end.
Load project config via: `node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init observe`
</process>
