# Skill: orchestrator (TEAM)

<purpose>
Automated multi-agent pipeline orchestration. One command starts a configurable lifecycle
with optimization feedback loops. Stages are selectable via --stages.
Uses Claude Code native TeamCreate + Agent + TaskCreate + SendMessage mechanisms.
</purpose>

<core_principle>
The orchestrator is a coordinator, not an implementer. It creates the team, spawns agents
sequentially based on dependency gates, handles feedback loops (reviewer FAIL → coder fix,
verifier FAIL → vllm-opter → planner re-plan), and cleans up when done.

Agents are spawned using their native subagent_type (e.g., "devteam:coder") so that tool
restrictions and permissionMode from their frontmatter are enforced by Claude Code.
The orchestrator owns all user interaction (AskUserQuestion) since plugin agents cannot use it.
</core_principle>

<process>

<step name="INIT" priority="first">
Initialize workflow context and parse arguments.

```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devteam/devteam/*/lib/devteam.cjs 2>/dev/null | head -1)
```

Parse from $ARGUMENTS:
- **FEATURE**: first positional arg (optional — will prompt if not provided)
- **--stages X,Y,Z**: comma-separated stages to run (default: all)
  Valid stages: `spec,plan,code,review,build,ship,verify`
- **--max-loops N**: max optimization iterations (default from tuning config)
- **--skip-spec**: shorthand for removing `spec` from stages (backward compat)

```bash
FEATURE="$1"
if [ -n "$FEATURE" ]; then
  INIT=$(node "$DEVFLOW_BIN" init team --feature "$FEATURE")
else
  INIT=$(node "$DEVFLOW_BIN" init team)
fi
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
```

**Feature selection**: If `$INIT` has `feature: null` and `available_features` list, use AskUserQuestion
to let the user pick a feature from the list. Then re-run `init team --feature $SELECTED`.

**Stage selection**:
```
ALL_STAGES = [spec, plan, code, review, build, ship, verify]

if --stages provided:
  STAGES = parse comma-separated list, validate each against ALL_STAGES
elif --skip-spec:
  STAGES = ALL_STAGES minus "spec"
else:
  STAGES = ALL_STAGES
```

```bash
MAX_LOOPS=$(echo "$INIT" | jq -r '.tuning.max_optimization_loops // 3')
```

**Checkpoint resume**: Load STATE.md for feature. If `completed_stages` is non-empty and
`pipeline_stages` matches current `STAGES`:
- Ask user: "Previous pipeline was interrupted after [completed]. Resume from [next]? Or restart?"
- If resume: set STAGES to remaining uncompleted stages
- If restart: clear `completed_stages`

Gates:
- workspace.yaml must exist
- Feature must be listed in workspace.yaml defaults.features
- If "spec" in STAGES and spec.md exists, ask user whether to re-spec or skip
</step>

<step name="CREATE_TEAM">
Create the team and task list — only for selected stages.

1. `TeamCreate(team_name: "devteam-$FEATURE", description: "Pipeline for $FEATURE")`

2. Record pipeline stages in STATE.md:
```bash
node "$DEVFLOW_BIN" state update pipeline_stages "$STAGES_CSV"
node "$DEVFLOW_BIN" state update completed_stages ""
```

3. Create tasks dynamically — only for stages in STAGES:
```
prev_task = null
for stage in STAGES:
  T[stage] = TaskCreate(subject: "<stage description for $FEATURE>")
  if prev_task: TaskUpdate(T[stage], addBlockedBy: [prev_task])
  prev_task = T[stage]
```

Stage descriptions:
- spec: "Define requirements for $FEATURE"
- plan: "Create implementation plan"
- code: "Implement plan"
- review: "Review implementation"
- build: "Build Docker image"
- ship: "Deploy to cluster"
- verify: "Verify deployment"

Report to user:
```
devteam pipeline for: $FEATURE
Stages: $STAGES_CSV
Max optimization loops: $MAX_LOOPS
```
</step>

<step name="RUN_SPEC">
**Guard: skip if "spec" not in STAGES.**

1. Use AskUserQuestion to collect requirements (5 questions: goal, scope, constraints, verification, out-of-scope)
2. Compile into requirements brief
3. Spawn:
```
Agent(
  name: "spec-agent",
  subagent_type: "devteam:spec",
  team_name: "devteam-$FEATURE",
  prompt: "Generate spec.md for feature '$FEATURE' in workspace $WORKSPACE.
    User requirements: $REQUIREMENTS_BRIEF
    Your task ID: $T_SPEC_ID"
)
```
4. Wait for completion. Verify `spec.md` exists.
5. Checkpoint:
```bash
node "$DEVFLOW_BIN" state update completed_stages "spec"
node "$DEVFLOW_BIN" state update feature_stage "spec"
```
</step>

<step name="RUN_PLAN">
**Guard: skip if "plan" not in STAGES.**

```
Agent(
  name: "planner",
  subagent_type: "devteam:planner",
  team_name: "devteam-$FEATURE",
  prompt: "Create implementation plan for feature '$FEATURE' in workspace $WORKSPACE.
    Spec: $WORKSPACE/.dev/features/$FEATURE/spec.md
    [OPTIMIZATION_CONTEXT if present]
    Your task ID: $T_PLAN_ID"
)
```

Wait for completion. Verify `plan.md` exists.
Checkpoint: append "plan" to `completed_stages`, update `feature_stage`.
</step>

<step name="RUN_CODE">
**Guard: skip if "code" not in STAGES.**

```
Agent(
  name: "coder",
  subagent_type: "devteam:coder",
  team_name: "devteam-$FEATURE",
  prompt: "Implement the plan for feature '$FEATURE' in workspace $WORKSPACE.
    Plan: $WORKSPACE/.dev/features/$FEATURE/plan.md
    [FIX_CONTEXT if reviewer sent fix instructions]
    Your task ID: $T_CODE_ID"
)
```

Wait for completion.
Checkpoint: append "code" to `completed_stages`, update `feature_stage`.
</step>

<step name="RUN_REVIEW">
**Guard: skip if "review" not in STAGES.**

Max 2 review cycles.
```
review_cycle = 0
max_review_cycles = 2
```

Loop:
```
Agent(
  name: "reviewer",
  subagent_type: "devteam:reviewer",
  team_name: "devteam-$FEATURE",
  prompt: "Review implementation for feature '$FEATURE' in workspace $WORKSPACE.
    Spec: $WORKSPACE/.dev/features/$FEATURE/spec.md
    Plan: $WORKSPACE/.dev/features/$FEATURE/plan.md
    Your task ID: $T_REVIEW_ID"
)
```

Parse verdict:
- **PASS** or **PASS_WITH_WARNINGS** → checkpoint "review", proceed
- **FAIL** →
  1. Extract remediation items
  2. If review_cycle < max_review_cycles: re-spawn coder with FIX_CONTEXT, then re-spawn reviewer, review_cycle++
  3. Else: AskUserQuestion for guidance
</step>

<step name="RUN_BUILD">
**Guard: skip if "build" not in STAGES.**

```
Agent(
  name: "builder",
  subagent_type: "devteam:builder",
  team_name: "devteam-$FEATURE",
  prompt: "Build Docker image for feature '$FEATURE' in workspace $WORKSPACE.
    Your task ID: $T_BUILD_ID"
)
```

Wait for completion. Extract `$NEW_TAG` from builder's message.
If failure: AskUserQuestion (retry / abort).
Checkpoint: append "build" to `completed_stages`, update `feature_stage`.
</step>

<step name="RUN_SHIP">
**Guard: skip if "ship" not in STAGES.**

1. Check cluster safety from `$INIT`:
   - `safety: prod` → AskUserQuestion to confirm before spawning shipper
   - User declines → abort gracefully

2. Spawn:
```
Agent(
  name: "shipper",
  subagent_type: "devteam:shipper",
  team_name: "devteam-$FEATURE",
  prompt: "Deploy image '$NEW_TAG' for feature '$FEATURE' to cluster.
    Workspace: $WORKSPACE
    [CONFIRMED: user approved deployment]
    Your task ID: $T_SHIP_ID"
)
```

If failure: AskUserQuestion (retry / abort).
Checkpoint: append "ship" to `completed_stages`, update `feature_stage`.
</step>

<step name="RUN_VERIFY">
**Guard: skip if "verify" not in STAGES.**

```
Agent(
  name: "verifier",
  subagent_type: "devteam:verifier",
  team_name: "devteam-$FEATURE",
  prompt: "Verify deployment for feature '$FEATURE'. Run smoke checks and benchmarks.
    Workspace: $WORKSPACE
    Your task ID: $T_VERIFY_ID"
)
```

Verdict:
- **PASS** → checkpoint "verify", go to CLEANUP
- **FAIL** → go to OPTIMIZATION_LOOP
</step>

<step name="OPTIMIZATION_LOOP">
Triggered when verifier reports FAIL. Only runs if "verify" is in STAGES.

```
loop_count = 0
```

While verifier FAIL and loop_count < MAX_LOOPS:

1. Checkpoint: `node "$DEVFLOW_BIN" state update pipeline_loop_count "$loop_count"`

2. Spawn vLLM-Opter:
```
Agent(
  name: "vllm-opter",
  subagent_type: "devteam:vllm-opter",
  team_name: "devteam-$FEATURE",
  prompt: "Analyze performance regression for '$FEATURE'.
    Regression report: <verifier_metrics>
    Workspace: $WORKSPACE
    Your task ID: $OPT_TASK_ID"
)
```

3. Wait for optimization guidance

4. Re-run sub-pipeline (only stages that make sense for optimization):
   - RUN_PLAN (with OPTIMIZATION_CONTEXT)
   - RUN_CODE
   - RUN_REVIEW
   - RUN_BUILD
   - RUN_SHIP
   - RUN_VERIFY

5. `loop_count++`

If exhausted:
```
AskUserQuestion:
  - "Continue with N more loops"
  - "Accept current performance"
  - "Abort pipeline"
```
</step>

<step name="CLEANUP">
Pipeline complete.

1. Update phase:
```bash
node "$DEVFLOW_BIN" state update phase completed
node "$DEVFLOW_BIN" state update completed_stages "$ALL_COMPLETED_CSV"
```

2. Checkpoint:
```bash
node "$DEVFLOW_BIN" checkpoint --action "team-complete" --summary "Pipeline complete for $FEATURE"
```

3. `TeamDelete`

4. Report summary:
```
Pipeline Complete: $FEATURE
  Stages: $STAGES_CSV
  Tasks completed: N
  [Image: $NEW_TAG]           # if build was in STAGES
  [Cluster: $CLUSTER/$NS]    # if ship was in STAGES
  [Verification: PASS]        # if verify was in STAGES
  Optimization loops: $loop_count
```
</step>

</process>

<anti_rationalization>

| Temptation | Reality |
|---|---|
| "Skip the spec, I know what to build" | Unstated assumptions cause 80% of rework |
| "The review is just formality" | AI code needs MORE scrutiny, not less |
| "Skip verification, tests passed locally" | Production has different data, traffic, edge cases |
| "One more optimization loop will fix it" | 3 loops is the safety valve. Ask the human. |
| "I'll deploy without GPU checks" | GPU env issues cause silent correctness bugs and OOMs |
| "Use general-purpose agent instead of native type" | Native subagent_type enforces tool restrictions. General-purpose has no guardrails. |
| "Run all stages even though user said --stages" | Respect the user's selection. They know their workflow. |

**Red Flags:**
- Running stages not in STAGES list
- Using `subagent_type: "general-purpose"` instead of `"devteam:XXX"`
- Skipping checkpoint writes between stages
- Ignoring reviewer FAIL verdict
- Optimization loop exceeding max without user consent
- kubectl commands missing `-n <namespace>`

</anti_rationalization>
