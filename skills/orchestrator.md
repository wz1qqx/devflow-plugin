# Skill: orchestrator (TEAM)

<purpose>
Automated multi-agent pipeline orchestration. One command starts the full lifecycle:
Spec → Plan → Code → Review → Build → Ship → Verify, with optimization feedback loops.
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
- **--max-loops N**: max optimization iterations (default: `tuning.max_optimization_loops`, typically 3)
- **--skip-spec**: skip spec phase if spec.md already exists

```bash
# Load context with feature if provided
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

```bash
MAX_LOOPS=$(echo "$INIT" | jq -r '.tuning.max_optimization_loops // 3')
```

Gates:
- .dev.yaml must exist
- Feature must be defined in .dev.yaml (resolved via argument, auto-select, or user prompt)
- If not --skip-spec and spec.md exists, ask user whether to re-spec or skip
</step>

<step name="CREATE_TEAM">
Create the team and task list.

1. `TeamCreate(team_name: "devteam-$FEATURE", description: "Automated pipeline for $FEATURE")`

2. Create tasks with dependency chain:

```
If spec needed:
  T1 = TaskCreate(subject: "Define requirements for $FEATURE")

T2 = TaskCreate(subject: "Create implementation plan")
  → TaskUpdate(addBlockedBy: [T1]) if T1 exists

T3 = TaskCreate(subject: "Implement plan")
  → TaskUpdate(addBlockedBy: [T2])

T4 = TaskCreate(subject: "Review implementation")
  → TaskUpdate(addBlockedBy: [T3])

T5 = TaskCreate(subject: "Build Docker image")
  → TaskUpdate(addBlockedBy: [T4])

T6 = TaskCreate(subject: "Deploy to cluster")
  → TaskUpdate(addBlockedBy: [T5])

T7 = TaskCreate(subject: "Verify deployment")
  → TaskUpdate(addBlockedBy: [T6])
```

Report to user:
```
devteam pipeline started for: $FEATURE
Tasks: 7 (or 6 if --skip-spec)
Max optimization loops: $MAX_LOOPS
```
</step>

<step name="RUN_SPEC">
If spec phase needed (T1 exists):

**IMPORTANT**: The spec agent cannot use AskUserQuestion (plugin agent limitation).
The orchestrator must pre-collect requirements from the user BEFORE spawning the spec agent.

1. Use AskUserQuestion to ask the user the 5 mandatory spec questions:
   - Goal: What is the desired outcome?
   - Scope: Which repos/files are involved?
   - Constraints: API compat, performance targets, dependencies?
   - Verification: How will we know it works?
   - Out-of-scope: What explicitly will NOT be done?

2. Compile user answers into a requirements brief.

3. Spawn spec agent with the collected answers:
```
Agent(
  name: "spec-agent",
  subagent_type: "devteam:spec",
  team_name: "devteam-$FEATURE",
  prompt: "Generate spec.md for feature '$FEATURE' in workspace $WORKSPACE.
    User requirements:
    $REQUIREMENTS_BRIEF
    Your task ID: $T1_ID"
)
```

4. Wait for spec agent message via SendMessage
5. Verify `.dev/features/$FEATURE/spec.md` exists
</step>

<step name="RUN_PLAN">
Plan phase (T2).

Build prompt context:
- Base: spec path `.dev/features/$FEATURE/spec.md`
- If this is an optimization re-plan: append vLLM-Opter's guidance

```
Agent(
  name: "planner",
  subagent_type: "devteam:planner",
  team_name: "devteam-$FEATURE",
  prompt: "Create implementation plan for feature '$FEATURE' in workspace $WORKSPACE.
    Spec: $WORKSPACE/.dev/features/$FEATURE/spec.md
    [OPTIMIZATION_CONTEXT if present]
    Your task ID: $T2_ID"
)
```

Wait for completion. Verify `plan.md` exists.
</step>

<step name="RUN_CODE">
Code phase (T3).

```
Agent(
  name: "coder",
  subagent_type: "devteam:coder",
  team_name: "devteam-$FEATURE",
  prompt: "Implement the plan for feature '$FEATURE' in workspace $WORKSPACE.
    Plan: $WORKSPACE/.dev/features/$FEATURE/plan.md
    [FIX_CONTEXT if reviewer sent fix instructions]
    Your task ID: $T3_ID"
)
```

Wait for completion.
</step>

<step name="RUN_REVIEW">
Review phase (T4). Max 2 review cycles.

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
    Your task ID: $T4_ID"
)
```

Wait for verdict message. Parse verdict:
- **PASS** or **PASS_WITH_WARNINGS** → proceed to BUILD
- **FAIL** →
  1. Extract remediation items from reviewer's message
  2. If review_cycle < max_review_cycles:
     - Create new fix task
     - Re-spawn coder with fix instructions as FIX_CONTEXT
     - Re-spawn reviewer
     - review_cycle++
  3. Else: report to user, ask for guidance via AskUserQuestion
</step>

<step name="RUN_BUILD">
Build phase (T5).

```
Agent(
  name: "builder",
  subagent_type: "devteam:builder",
  team_name: "devteam-$FEATURE",
  prompt: "Build Docker image for feature '$FEATURE' in workspace $WORKSPACE.
    Your task ID: $T5_ID"
)
```

Wait for completion. Extract new image tag from builder's message.
Store as `$NEW_TAG`.

If builder reports failure: report to user via AskUserQuestion (retry / abort).
</step>

<step name="RUN_SHIP">
Deploy phase (T6).

**IMPORTANT**: The shipper agent cannot use AskUserQuestion. For production clusters
(safety: prod), the orchestrator must confirm with the user BEFORE spawning the shipper.

1. Check cluster safety level from `$INIT`:
   - If `safety: prod`: use AskUserQuestion to confirm deployment with user
     ("Deploy $NEW_TAG to production cluster $CLUSTER/$NAMESPACE? Type namespace name to confirm.")
   - If user declines: abort pipeline gracefully

2. Spawn shipper:
```
Agent(
  name: "shipper",
  subagent_type: "devteam:shipper",
  team_name: "devteam-$FEATURE",
  prompt: "Deploy image '$NEW_TAG' for feature '$FEATURE' to cluster.
    Workspace: $WORKSPACE
    [CONFIRMED: user approved production deployment]
    Your task ID: $T6_ID"
)
```

Wait for deployment confirmation.
If shipper reports failure: report to user via AskUserQuestion (retry / abort).
</step>

<step name="RUN_VERIFY">
Verify phase (T7).

```
Agent(
  name: "verifier",
  subagent_type: "devteam:verifier",
  team_name: "devteam-$FEATURE",
  prompt: "Verify deployment for feature '$FEATURE'. Run smoke checks and benchmarks.
    Workspace: $WORKSPACE
    Your task ID: $T7_ID"
)
```

Wait for verdict:
- **PASS** → pipeline complete, go to CLEANUP
- **FAIL** → go to OPTIMIZATION_LOOP
</step>

<step name="OPTIMIZATION_LOOP">
Triggered when verifier reports FAIL (performance regression).

```
loop_count = 0
```

While verifier FAIL and loop_count < MAX_LOOPS:

1. **Spawn vLLM-Opter**:
```
Agent(
  name: "vllm-opter",
  subagent_type: "devteam:vllm-opter",
  team_name: "devteam-$FEATURE",
  prompt: "Analyze performance regression for '$FEATURE'.
    Regression report: <verifier_metrics_from_message>
    Workspace: $WORKSPACE
    Your task ID: $OPT_TASK_ID"
)
```

2. Wait for optimization guidance

3. **Re-run pipeline with optimization context**:
   - RUN_PLAN with optimization guidance as OPTIMIZATION_CONTEXT
   - RUN_CODE
   - RUN_REVIEW
   - RUN_BUILD
   - RUN_SHIP
   - RUN_VERIFY

4. `loop_count++`

If loop_count >= MAX_LOOPS and still FAIL:
```
Report to user via AskUserQuestion:
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
```

2. Checkpoint:
```bash
node "$DEVFLOW_BIN" checkpoint --action "team-complete" --summary "Pipeline complete for $FEATURE"
```

3. `TeamDelete` — clean up team resources

4. Report final summary:
```
Pipeline Complete: $FEATURE
  Tasks completed: N
  Image: $NEW_TAG
  Cluster: $CLUSTER/$NAMESPACE
  Verification: PASS
  Optimization loops: $loop_count
  Duration: ~Xm
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

**Red Flags:**
- Skipping any pipeline phase
- Using `subagent_type: "general-purpose"` instead of `"devteam:XXX"`
- Deploying without verification
- Ignoring reviewer FAIL verdict
- Optimization loop exceeding max without user consent
- kubectl commands missing `-n <namespace>`

</anti_rationalization>
