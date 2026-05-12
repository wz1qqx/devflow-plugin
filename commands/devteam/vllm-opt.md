---
name: devteam:vllm-opt
description: vLLM optimization — benchmark, profile, and diagnose inference regressions
argument-hint: "[--root <path>] [--set <track>] [benchmark/profile context]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<objective>
Use the independent vllm-opt skill to analyze TTFT/TPOT/throughput regressions with benchmark evidence, profiler traces, and kernel/category breakdowns.
</objective>

<execution_context>
@../../skills/vllm-opt/SKILL.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover the devteam CLI:
```bash
DEVTEAM_BIN="${HOME}/.claude/plugins/marketplaces/devteam/lib/devteam.cjs"
[ -f "$DEVTEAM_BIN" ] || DEVTEAM_BIN=$(ls ~/.claude/plugins/cache/devteam/devteam/*/lib/devteam.cjs 2>/dev/null | head -1)
[ -n "$DEVTEAM_BIN" ] || { echo "ERROR: devteam.cjs not found" >&2; exit 1; }
```

If no `--root` is provided, use the current workspace or nearest parent containing `.devteam/config.yaml`. Do not select a global active track; ask the user to choose a track or pass `--set <track>` when the command needs one.

**Step 2**: Read the skill file and execute it end-to-end:
```bash
SKILL_FILE="${HOME}/.claude/plugins/marketplaces/devteam/skills/vllm-opt/SKILL.md"
[ -f "$SKILL_FILE" ] || SKILL_FILE=$(ls ~/.claude/plugins/cache/devteam/devteam/*/skills/vllm-opt/SKILL.md 2>/dev/null | head -1)
[ -n "$SKILL_FILE" ] || { echo "ERROR: skill file not found" >&2; exit 1; }
```
Read `$SKILL_FILE` for the full process, then follow it step by step.
</process>
