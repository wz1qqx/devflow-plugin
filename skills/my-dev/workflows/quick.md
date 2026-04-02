# Workflow: quick

<purpose>Execute small ad-hoc tasks without full spec→plan→exec ceremony. Plan (max 3 tasks) + execute + atomic commit in one pass.</purpose>
<core_principle>Same quality guarantees (source_restriction, atomic commits) but less ceremony. For changes small enough to plan + execute in one session.</core_principle>

<process>

<step name="INIT" priority="first">
Parse arguments and load context.

```
Flags:
  --discuss   → surface gray areas first
  --research  → check Obsidian knowledge
  --full      → plan-checker + post-exec verification

Remaining text → DESCRIPTION
```

```bash
# Auto-discover devflow CLI (marketplace or local install)
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)
DEVFLOW_BIN="${DEVFLOW_BIN:-$HOME/.claude/my-dev/bin/my-dev-tools.cjs}"

INIT=$(node "$DEVFLOW_BIN" init quick "$DESCRIPTION")
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
FEATURE=$(echo "$INIT" | jq -r '.feature.name')
TODAY=$(date +%Y%m%d)
SLUG=$(echo "$DESCRIPTION" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-' | head -c 40)
[ -z "$SLUG" ] && SLUG="quick-$(date +%s)"
QUICK_DIR="$WORKSPACE/.dev/quick/${TODAY}-${SLUG}"
mkdir -p "$QUICK_DIR"
```
</step>

<step name="DISCUSS" condition="--discuss">
Lightweight gray-area check (same approach as discuss.md but shorter):
1. Identify 2-3 ambiguities in the task
2. Present as quick choices (AskUserQuestion)
3. Save to `$QUICK_DIR/context.md`
</step>

<step name="KNOWLEDGE_CHECK" condition="--research">
Delegate to learn.md workflow for Obsidian knowledge check.
Load result into planner context.
</step>

<step name="PLAN_AND_EXECUTE">
Combined plan + execute in one pass.

**Plan**: Spawn my-dev-planner agent in quick mode:
- Max 3 tasks, no wave ordering needed
- Each task: repo, worktree, files, action, verify command
- Constraints: source_restriction from .dev.yaml

**Check** (if --full): Spawn my-dev-plan-checker, max 2 iterations.

**Execute**: For each task:
- 1 task → execute inline (no subagent overhead)
- 2-3 tasks with no deps → parallel my-dev-executor agents
- Atomic commit per task: `feat(quick): <task_description>`
- Source_restriction enforced

**Verify** (if --full): Run verify commands from plan, report pass/fail.
</step>

<step name="ERROR_HANDLING">
If any tasks failed:

```
Quick task results: $DONE/$TOTAL completed | $FAILED failed
```

Options:
- If failed < total: "Partial success. Review completed tasks? [Y/n]"
- If all failed: suggest escalating to full pipeline:
  "All quick tasks failed. Consider `/devflow:code $FEATURE --spec` for a more structured approach."
- Always: show error context from failed tasks for debugging
</step>

<step name="SAVE_SUMMARY">
Save to `$QUICK_DIR/summary.md`:
- Tasks completed with commit hashes
- Tasks failed with error context
- Files changed by repo

Update STATE.md quick tasks table.
</step>

</process>
