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
INIT=$(node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init next)
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
</step>

<step name="DETECT_STATE">
Apply routing rules in priority order.

**Route 0: HANDOFF exists → resume**
If `.dev/HANDOFF.json` exists:
```
⏸️  Paused session detected
  Feature: <feature>
  Stage: <stage> (Task <current>/<total>)

→ /devflow:resume
```

**Route 1: Active feature with incomplete stage → continue feature**
If STATE.md has `current_feature` and `feature_stage`:

| feature_stage | Artifacts Check | Next |
|--------------|----------------|------|
| `spec` | spec.md exists, no context.md | → `/devflow:discuss <feature>` |
| `discuss` | context.md exists, no plan.md | → `/devflow:code <feature> --plan` |
| `plan` | plan.md exists, tasks pending | → `/devflow:code <feature> --exec` |
| `exec` | all tasks done, no review.md | → `/devflow:code <feature> --review` |
| `review` | review PASS | → `/devflow:build` |
| `review` | review FAIL | → `/devflow:code <feature> --exec` (fix issues) |

**Route 2: Phase-level progression (no active feature)**

| phase | Condition | Next |
|-------|-----------|------|
| `init` | .dev.yaml exists | → `/devflow:resume` or `/devflow:code <feature> --spec` |
| `dev` | changes in worktrees | → `/devflow:build` |
| `build` | current_tag updated | → `/devflow:deploy` |
| `deploy` | pods ready (check kubectl if reachable) | → `/devflow:verify --smoke` |
| `verify` | smoke passed, no bench | → `/devflow:verify --bench` |
| `verify` | bench passed | → `/devflow:observe --dashboard` |
| `verify` | bench regression > 20% | → `/devflow:debug benchmark` |
| `debug` | investigation open | → "Continue debug or `/devflow:debug --close`" |

**Route 3: Everything complete**
If all phases satisfied and no pending work:
```
✅ Current cycle complete
  Project: <project>
  Tag: <current_tag>

  Options:
  - Start new feature: /devflow:code <new-feature> --spec
  - Start new project: /devflow:switch <project>
```
</step>

<step name="SHOW_AND_SUGGEST">
Display determination with full context.

```
━━━━━━━━━━━━━━━━━━━━━━━
 MY-DEV ► NEXT
━━━━━━━━━━━━━━━━━━━━━━━

Project: <project_name>
Phase: <phase> | Tag: <current_tag>
Feature: <feature> (<stage>) | Progress: <plan_progress>

<Detection reasoning>

→ Next: <suggested_command>
  <one-line explanation>

Run it? [Y/n]
```

If user confirms (Y or Enter):
- Execute the suggested command directly
- This enables `/devflow:next` → Y → `/devflow:next` → Y chains for rapid progression
</step>

</process>
