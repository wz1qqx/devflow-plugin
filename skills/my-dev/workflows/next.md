# Workflow: next

<purpose>
Detect current project state and automatically advance to the next logical workflow step.
Zero-friction pipeline progression — user doesn't need to remember what comes after what.
</purpose>

<core_principle>
Read all state signals (.dev.yaml phase, STATE.md position, .dev/features/ artifacts, deployment status) and deterministically route to the next action.
</core_principle>

<process>

<step name="INIT" priority="first">
Load project state.

```bash
# Auto-discover devflow CLI (marketplace or local install)
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)

INIT=$(node "$DEVFLOW_BIN" init next)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
PROJECT_NAME=$(echo "$INIT" | jq -r '.feature.name')
PHASE=$(echo "$INIT" | jq -r '.feature.phase')
CURRENT_TAG=$(echo "$INIT" | jq -r '.feature.current_tag')
```

Also read STATE.md if exists:
```bash
STATE_FILE="$WORKSPACE/.dev/STATE.md"
```

Parse: `current_feature`, `feature_stage`, `plan_progress`, `blockers`.

Scan `.dev/features/` for all feature directories and their artifact status.

Check HANDOFF.json existence.

**Gate: No feature configured**
If `PROJECT_NAME` is empty or null:
```
No active feature found.

→ /devflow:init feature <name>
  Create a new feature to start developing.
```
Stop here. Do not proceed to routing.
</step>

<step name="DETECT_STATE">
Apply routing rules in priority order.

**Route 0: HANDOFF exists → resume**
If `.dev/HANDOFF.json` or `.dev/features/$PROJECT_NAME/HANDOFF.json` exists:
```
⏸️  Paused session detected
  Feature: <feature>
  Stage: <stage> (Task <current>/<total>)

→ /devflow:resume
```

**Route 1: Feature coding pipeline → artifact-driven routing**
Check artifacts in `.dev/features/$PROJECT_NAME/` and route based on what EXISTS (not the phase field):

| Condition | Next |
|-----------|------|
| No spec.md | → `/devflow:code $PROJECT_NAME --spec` |
| spec.md exists, no context.md | → `/devflow:discuss $PROJECT_NAME` |
| context.md exists, no plan.md | → `/devflow:code $PROJECT_NAME --plan` |
| plan.md exists, tasks pending | → `/devflow:code $PROJECT_NAME --exec` |
| plan.md exists, all tasks done, no review.md | → `/devflow:code $PROJECT_NAME --review` |
| review.md exists, verdict PASS | → continue to Route 2 (lifecycle phase) |
| review.md exists, verdict FAIL | → `/devflow:code $PROJECT_NAME --exec` (fix issues) |

This is ordered from earliest to latest stage. The FIRST matching condition wins.

**Route 2: Lifecycle phase progression**

| phase | Condition | Next |
|-------|-----------|------|
| `init` | No artifacts exist | → `/devflow:code $PROJECT_NAME --spec` |
| `spec` | (handled by Route 1) | → Route 1 |
| `discuss` | (handled by Route 1) | → Route 1 |
| `plan` | (handled by Route 1) | → Route 1 |
| `exec` | (handled by Route 1) | → Route 1 |
| `review` | (handled by Route 1) | → Route 1 |
| `dev` | changes in worktrees | → `/devflow:build` |
| `build` | current_tag updated | → `/devflow:deploy` |
| `deploy` | pods ready (check kubectl if reachable) | → `/devflow:verify --smoke` |
| `verify` | smoke passed, no bench | → `/devflow:verify --bench` |
| `verify` | bench passed | → `/devflow:observe --dashboard` |
| `verify` | bench regression > $REGRESSION_THRESHOLD% | → `/devflow:debug benchmark` |
| `debug` | investigation open | → "Continue debug or `/devflow:debug --close`" |
| `completed` | — | → Route 3 |

**Route 3: Cycle complete**
If all phases satisfied and no pending work:
```
✅ Current cycle complete
  Feature: $PROJECT_NAME
  Tag: $CURRENT_TAG

  Options:
  - Start new feature: /devflow:init feature <name>
  - Switch feature: /devflow:switch <feature>
```
</step>

<step name="SHOW_AND_SUGGEST">
Display determination with full context.

```
━━━━━━━━━━━━━━━━━━━━━━━
 DEVFLOW ► NEXT
━━━━━━━━━━━━━━━━━━━━━━━

Feature: $PROJECT_NAME ($PHASE)
Tag: $CURRENT_TAG
Progress: <plan_progress if applicable>

<Detection reasoning: which route matched and why>

→ Next: <suggested_command>
  <one-line explanation>
```

Ask via AskUserQuestion: "执行？" with options:
- "执行" → Run the suggested command directly
- "跳过，告诉我下一步就好" → Just show, don't execute

This enables `/devflow:next` → 执行 → `/devflow:next` → 执行 chains for rapid progression.
</step>

</process>
