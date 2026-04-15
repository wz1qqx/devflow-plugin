# Next Session Continuation Plan

This document is the handoff for the next coding session. It assumes the current uncommitted changes in this worktree are intentional and should be preserved.

## What Has Already Been Completed

The repo has already moved through the highest-risk stabilization work:

- `lib/init.cjs` now supports workspace-level `init` workflows without requiring `active_feature`.
- `lib/state.cjs` and `lib/session.cjs` now support empty-string state resets.
- Feature-scoped runtime memory now comes from `.dev/features/<feature>/context.md`, not the global `STATE.md` table.
- Reviewer persistence is orchestrator-owned; reviewer no longer writes `review.md` itself.
- `ship.strategy` is now explicitly restricted to `k8s`.
- The wave model is documented as planning structure only; execution remains serial with one coder.
- Statusline support was rebuilt around `hooks/devteam-statusline.js`.
- Versioning is now sourced from `VERSION` via `lib/version.cjs` and `bin/sync-version.cjs`.
- Stage-result handling was pulled into reusable helpers:
  - `lib/stage-result.cjs`
  - `lib/stage-decision.cjs`
  - `lib/stage-acceptance.cjs`
  - `lib/pipeline-state.cjs`
  - `lib/orchestration-kernel.cjs`
- `skills/orchestrator.md` now prefers high-level helpers:
  - `node "$DEVTEAM_BIN" orchestration resolve-stage ...`
  - `node "$DEVTEAM_BIN" pipeline ...`
- Regression coverage exists for Weeks 1-5 under `tests/`.

## Current Invariants

Do not regress these decisions unless the product direction changes explicitly:

1. `workspace.yaml` + per-feature `.dev/features/<name>/config.yaml` is the only supported config model.
2. `context.md` is the source of truth for feature decisions and blockers.
3. `orchestration resolve-stage` is the preferred prompt-layer entrypoint; `stage-result parse|decide|accept` are lower-level helpers.
4. `ship.strategy` currently supports only `k8s`.
5. Wave structure is planning metadata only; actual execution is still serial.
6. Reviewer should remain effectively read-only from the workflow perspective.
7. Command Markdown in `commands/devteam/*.md` is generated output; the source of truth is:
   - `commands/devteam/_registry.yaml`
   - `bin/generate-commands.cjs`

## Fast Context Load Order For A New Session

If a future session has to reload context quickly, read in this order:

1. `NEXT_SESSION_PLAN.md`
2. `skills/orchestrator.md`
3. `lib/orchestration-kernel.cjs`
4. `lib/stage-decision.cjs`
5. `lib/pipeline-state.cjs`
6. `tests/week3-stage-result-contract.test.cjs`
7. `tests/week3-orchestration-kernel.test.cjs`
8. `README.md` only for user-facing contract verification

## Highest-Priority Remaining Work

### Phase 1: Finish The Command-Generation And Naming Cleanup

This is the most obvious remaining inconsistency.

#### Problem

The runtime and docs were largely renamed to `devteam`, but the generated command path is still stale:

- `bin/generate-commands.cjs` still emits `DEVFLOW_BIN`
- many generated files in `commands/devteam/*.md` still reference `DEVFLOW_BIN`
- some generated command docs still use old examples indirectly because they were not regenerated after the generator changed

#### Files To Touch

- `bin/generate-commands.cjs`
- `commands/devteam/_registry.yaml`
- regenerated `commands/devteam/*.md`
- optionally `README.md` if examples need to stay in sync
- new regression test, recommended: `tests/week4-command-generation.test.cjs`

#### Concrete Tasks

1. Update `bin/generate-commands.cjs` so generated output uses `DEVTEAM_BIN`, not `DEVFLOW_BIN`.
2. Keep the generated command process text aligned with current CLI behavior:
   - use `node "$DEVTEAM_BIN" init ...`
   - keep feature-selection wording consistent with `init`
   - keep `/devteam ...` command syntax consistent
3. Regenerate all files under `commands/devteam/`.
4. Verify the registry still describes the command contract accurately after regeneration.
5. Add a regression test that fails if generated command docs drift back to `DEVFLOW_BIN` or stale command syntax.

#### Acceptance Criteria

- `rg -n "DEVFLOW_BIN" bin/generate-commands.cjs commands/devteam` returns no matches.
- Generated command docs still point to the right skills and init workflows.
- `node bin/generate-commands.cjs` produces a clean regeneration with no manual follow-up edits required.
- New test passes.

#### Suggested Validation

```bash
node bin/generate-commands.cjs
node tests/week4-command-generation.test.cjs
rg -n "DEVFLOW_BIN" bin/generate-commands.cjs commands/devteam
```

### Phase 2: Make Orchestrator Branching Fully Decision-Driven

The helper stack exists, but the prompt layer still contains too much stage-specific natural-language branching.

#### Goal

Make the orchestrator consume a fully normalized decision payload instead of interpreting stage-specific details ad hoc.

#### Files To Touch

- `lib/stage-decision.cjs`
- `lib/orchestration-kernel.cjs`
- `skills/references/stage-result-contract.md`
- optionally add `skills/references/orchestration-decision-contract.md`
- `skills/orchestrator.md`
- tests:
  - `tests/week3-stage-decision.test.cjs`
  - `tests/week3-orchestration-kernel.test.cjs`
  - optional new contract test

#### Concrete Tasks

1. Normalize `decideStageResult()` output so every decision returns a stable shape.
   Recommended common fields:
   - `decision`
   - `reason`
   - `needs_user_input`
   - `retryable`
   - `next_action`
   - `user_prompt`
   - `loop_context`
   - `remediation_items`
   - `regressions`
2. Keep the meaning of the existing decision names stable:
   - `accept`
   - `review_fix_loop`
   - `optimization_loop`
   - `retry`
   - `needs_input`
3. Extend `orchestration resolve-stage` to surface this normalized decision payload directly.
4. Simplify `skills/orchestrator.md` so it branches only on:
   - `decision`
   - fixed payload fields from the helper output
5. Add regression coverage for each decision path and for helper output shape.

#### Acceptance Criteria

- The orchestrator no longer relies on stage-specific prose interpretation beyond fixed payload fields.
- Review FAIL, verify FAIL, retryable failure, and needs-input paths all have deterministic helper output.
- Tests fail if a decision path stops emitting its normalized fields.

#### Suggested Validation

```bash
node tests/week3-stage-decision.test.cjs
node tests/week3-orchestration-kernel.test.cjs
node tests/week3-stage-result-contract.test.cjs
```

### Phase 3: Harden CLI-Level Failure Paths

The happy path is covered reasonably well. Error-path behavior still needs more direct testing.

#### Goal

Make the helper CLI safe to rely on from prompt code by covering malformed input and boundary behavior.

#### Files To Touch

- `lib/stage-result.cjs`
- `lib/orchestration-kernel.cjs`
- `lib/pipeline-state.cjs`
- maybe `lib/devteam.cjs` if usage or command routing needs refinement
- tests, recommended additions:
  - `tests/week3-stage-result-errors.test.cjs`
  - `tests/week3-pipeline-state-errors.test.cjs`

#### Concrete Tasks

1. Add tests for malformed `STAGE_RESULT` blocks:
   - missing JSON block
   - wrong `stage`
   - missing required keys
   - wrong `retryable` type
2. Add tests for orchestration helper flags:
   - `--disable-optimization-loop`
   - review-cycle boundary behavior
3. Add tests for pipeline helper idempotency and edge cases:
   - reset on empty pipeline state
   - complete without prior loop count
   - loop count set/update behavior
4. Ensure stderr/error messages stay specific enough for prompt-layer recovery.

#### Acceptance Criteria

- The helper CLIs fail loudly and predictably on malformed agent output.
- Error messages remain specific enough to support a corrective agent re-prompt.
- No silent fallthrough remains in the main helper path.

#### Suggested Validation

```bash
node tests/week3-stage-result-parser.test.cjs
node tests/week3-stage-result-errors.test.cjs
node tests/week3-pipeline-state.test.cjs
node tests/week3-pipeline-state-errors.test.cjs
```

### Phase 4: Finalize Residual Naming Drift And Release Hygiene

Most of the rename is done, but a few migration-related leftovers still need an explicit decision.

#### Important Distinction

Some legacy names must remain temporarily as compatibility wrappers. Others should be removed now.

#### Keep For Compatibility

- `hooks/my-dev-context-monitor.js`
- `hooks/my-dev-statusline.js`
- `hooks/devflow-persistent.js`
- legacy temp-file fallback reads inside:
  - `hooks/devteam-context-monitor.js`
  - `hooks/devteam-persistent.js`

These should stay until a deliberate migration/removal step is scheduled.

#### Good Candidates To Clean Now

- `bin/setup.sh`
  - primary cache lookup should prefer `devteam`
  - legacy `devflow`/`my-dev` checks can remain as warnings only
- any remaining non-wrapper docs or generated files that still present old naming as active behavior

#### Acceptance Criteria

- Active runtime instructions use `devteam`, not `devflow`.
- Remaining `devflow` / `my-dev` references are clearly labeled as legacy compatibility only.
- Setup and local verification scripts do not accidentally prefer obsolete paths.

## Explicitly Deferred Work

These are not continuation tasks for the current stabilization stream unless the user re-prioritizes them:

1. True multi-coder wave fan-out / parallel execution
2. Additional `ship.strategy` implementations beyond `k8s`
3. Removing compatibility wrappers before a migration strategy is documented
4. Re-architecting the repo away from prompt-first orchestration

## Recommended Execution Order

If the next session has limited time, follow this order:

1. Phase 1: command-generation cleanup
2. Phase 2: decision-payload normalization
3. Phase 3: helper error-path hardening
4. Phase 4: release-hygiene cleanup

Do not start wave parallelism or extra ship strategies before these are finished.

## Suggested Start Commands For The Next Session

Run these first:

```bash
git status --short
sed -n '1,240p' NEXT_SESSION_PLAN.md
rg -n "DEVFLOW_BIN|devflow|my-dev" README.md commands/devteam bin hooks skills lib
node tests/week1-core.test.cjs
node tests/week2-context.test.cjs
node tests/week3-stage-result-contract.test.cjs
node tests/week3-orchestration-kernel.test.cjs
node tests/week4-hooks.test.cjs
node tests/week5-version.test.cjs
```

## Full Regression Command Set

Before closing the next session, run:

```bash
node tests/week1-core.test.cjs
node tests/week2-context.test.cjs
node tests/week3-ship-strategy.test.cjs
node tests/week3-stage-result-parser.test.cjs
node tests/week3-stage-decision.test.cjs
node tests/week3-stage-result-contract.test.cjs
node tests/week3-stage-acceptance.test.cjs
node tests/week3-pipeline-state.test.cjs
node tests/week3-orchestration-kernel.test.cjs
node tests/week4-statusline.test.cjs
node tests/week4-hooks.test.cjs
node tests/week5-version.test.cjs
```

If command generation is modified, also run:

```bash
node bin/generate-commands.cjs
node bin/sync-version.cjs --check
```

## Final Note For The Next Session

The repo is now much closer to a real orchestration kernel than when this effort started. The safest next move is not adding new product surface area; it is finishing the convergence work so that:

- prompt docs
- generated commands
- helper CLIs
- tests

all describe the same system without hidden exceptions.
