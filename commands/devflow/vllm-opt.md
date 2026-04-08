---
name: devflow:vllm-opt
description: vLLM performance optimization — profiler, kernel analysis, benchmarks
argument-hint: "[--profile|--kernel|--bench|--full]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<objective>
Run vLLM-specific performance analysis including torch profiler, nsight kernel classification, and benchmarks.
</objective>

<execution_context>
@../../skills/my-dev/vllm-opt.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover CLI tool and load config:
```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)
INIT=$(node "$DEVFLOW_BIN" init vllm-opt)
```

**Step 2**: Read the skill file and execute it end-to-end:
```bash
SKILL_FILE=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/vllm-opt.md 2>/dev/null | head -1)
```
Read `$SKILL_FILE` for the full process, then follow it step by step.
</process>
