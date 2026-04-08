# Skill: code (CODE)

<purpose>
Execute a wave-based implementation plan using TDD cycles. Each task follows RED-GREEN-REFACTOR with atomic commits. Tasks within the same wave run in parallel via subagents.

You are an executor, not a designer. The plan is the contract — follow it precisely.
</purpose>

<core_principle>
Every line of code is born from a failing test. Every commit is atomic and self-contained. Every wave checkpoint survives session boundaries. Discipline in execution prevents chaos in production.
</core_principle>

<process>

<step name="INIT" priority="first">
Initialize workflow context and validate prerequisites.

```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)

INIT=$(node "$DEVFLOW_BIN" init code)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
PROJECT=$(echo "$INIT" | jq -r '.feature.name')
FEATURE="$1"
```

Load feature context:
```bash
FEATURE_DIR="$WORKSPACE/.dev/features/$FEATURE"
PLAN_PATH="$FEATURE_DIR/plan.md"
SPEC_PATH="$FEATURE_DIR/spec.md"
CONTEXT_PATH="$FEATURE_DIR/context.md"
```

Parse flags:
- `--verify`: Run lint + test after each wave
- `--review-each`: Trigger mini code review (my-dev-reviewer) after each task
- `--sequential`: Disable parallel execution, run all tasks serially

Gate: `plan.md` must exist at `$FEATURE_DIR/plan.md`. If not:
- "No plan found. Run `/devflow plan $FEATURE` first."
</step>

<step name="PARSE_PLAN">
Read plan.md and prepare execution state.

```bash
# Read plan.md content
# Parse waves, tasks, statuses, dependencies
```

1. Parse plan.md structure: extract waves, tasks, statuses, acceptance criteria, verification commands
2. Detect resume: skip tasks with `Status: done` or `Status: complete`
3. Group remaining tasks into waves, preserving original wave ordering
4. Count: total tasks, completed tasks, remaining tasks, remaining waves

If all tasks already complete:
- "All plan tasks are already done. Run `/devflow test` or `/devflow review` next."

Resume output:
```
Plan loaded: <FEATURE>
  Total: <N> tasks across <W> waves
  Completed: <C> tasks
  Remaining: <R> tasks in <RW> waves
  Starting from: Wave <X>
```
</step>

<step name="EXECUTE">
Execute each wave sequentially. Tasks within a wave run in parallel (or serial with --sequential).

**For each wave:**

1. Announce wave: `--- Wave <N>: <description> (<T> tasks) ---`
2. For each task in the wave, execute the TDD cycle:

   **RED** — Write a failing test for expected behavior:
   - Read the task's acceptance criteria
   - Write a test that captures the expected behavior
   - Run the test — it MUST fail (if it passes, the feature already exists or the test is wrong)

   **GREEN** — Implement minimum code to pass:
   - Write the simplest implementation that makes the test pass
   - No gold-plating, no premature abstraction
   - Run the test — it MUST pass

   **REFACTOR** — Clean up while keeping tests green:
   - Remove duplication, improve naming, simplify
   - Run tests after refactor — all MUST still pass
   - Skip if nothing to improve (not every task needs refactoring)

   **VERIFY** — Run tests + build:
   - Run the task's verification command from plan.md
   - If --verify flag: also run full lint + test suite
   - If --review-each flag: spawn **my-dev-reviewer** for mini review of the task diff

   **COMMIT** — Atomic commit with descriptive message:
   - Stage only files related to this task
   - Commit message: `feat(<scope>): <task description>`
   - One commit per task, never batch multiple tasks

3. Parallel execution (default):
   - Tasks in the same wave with no shared files: spawn as **my-dev-executor** subagents
   - Each subagent receives: task spec, file list, acceptance criteria, verification command
   - Collect results from all subagents before proceeding

4. Sequential execution (--sequential):
   - Execute tasks one at a time within each wave
   - Useful for debugging or when tasks have implicit dependencies

5. After each wave completes:
   - Update plan.md: mark completed tasks as `Status: done`
   - Checkpoint:
   ```bash
   node "$DEVFLOW_BIN" checkpoint \
     --action "code" \
     --summary "Wave <N> complete: <tasks_done> tasks done"
   ```
   - Report: `Wave <N> complete: <T> tasks done, <R> remaining`
</step>

<step name="ERROR_RECOVERY">
Handle failures during execution.

**Test failure (RED stays red after GREEN):**
1. Re-read the acceptance criteria — is the test correct?
2. Check for missing dependencies or setup
3. If stuck after 2 attempts: enter debug mode
   - Spawn **my-dev-debugger** with: failing test, implementation, error output
   - Apply suggested fix, re-run verification

**Build failure:**
1. Check error output for missing imports, type errors, syntax issues
2. Fix and re-run verification
3. If fix touches files outside this task's scope: STOP and warn user

**Subagent failure (parallel mode):**
1. Collect the failure details from the subagent
2. Retry the failed task serially with full context
3. If still failing: pause wave, report to user, ask whether to skip or debug

On any unrecoverable failure:
```bash
node "$DEVFLOW_BIN" checkpoint \
  --action "code" \
  --summary "BLOCKED: <task_id> failed — <error_summary>"
```
</step>

<step name="COMPLETION">
Finalize coding phase after all waves complete.

Generate summary:
```bash
mkdir -p "$FEATURE_DIR"
# Write summary.md with: tasks completed, commits made, files changed, test results
```

Summary content:
```markdown
# Code Summary: <FEATURE>
Completed: <DATE>
Tasks: <N>/<N> complete
Commits: <C>
Files changed: <F>

## Wave Results
| Wave | Tasks | Status |
|------|-------|--------|
| 1    | <N>   | done   |

## Test Results
- Unit: <pass>/<total>
- Build: pass/fail
```

State update (@references/shared-patterns.md#state-update): phase=`code`

Checkpoint (@references/shared-patterns.md#checkpoint):
```bash
node "$DEVFLOW_BIN" checkpoint \
  --action "code" \
  --summary "Code complete for $FEATURE: $TASK_COUNT tasks, $COMMIT_COUNT commits"
```

Output:
```
Code complete: <FEATURE>
  Tasks: <N>/<N> done
  Commits: <C>
  Files changed: <F>

-> Next: /devflow test <FEATURE> or /devflow review <FEATURE>
```
</step>

</process>

<anti_rationalization>

| Rationalization | Reality |
|---|---|
| "Tests slow me down" | Tests catch bugs 10x cheaper than production. |
| "I'll add tests later" | Test debt is never repaid. |
| "I'll just fix this other thing too" | Scope creep in code is scope creep in review. |
| "This abstraction will be useful later" | Three uses before abstracting. YAGNI. |

**Red Flags:**
- 100+ lines written without running a test
- Scope creep: modifying files not listed in the task
- Broken builds between increments
- Building abstractions before the third use case
- Batching multiple tasks into one commit
- Skipping the RED step (writing code before tests)

**Verification:**
- [ ] All plan tasks completed (Status: done)
- [ ] All tests pass
- [ ] Build succeeds
- [ ] Atomic commits per task (one commit = one task)
- [ ] State updated to phase=code

</anti_rationalization>
</output>
