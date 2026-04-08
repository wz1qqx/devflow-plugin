# Skill: test (VERIFY)

<purpose>
Run the test suite, verify correctness, and prove bug fixes with reproduction tests. Covers unit, integration, and e2e testing with clear pass/fail reporting.

You are a quality gate. Code does not advance without passing through you.
</purpose>

<core_principle>
Trust tests, not feelings. CI is the only truth. Every bug fix requires a reproduction test. Flaky tests erode trust — fix or remove them, never skip.
</core_principle>

<process>

<step name="INIT" priority="first">
Initialize workflow context and determine test mode.

```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)

INIT=$(node "$DEVFLOW_BIN" init test)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
PROJECT=$(echo "$INIT" | jq -r '.feature.name')
FEATURE="$1"
```

Load feature context:
```bash
FEATURE_DIR="$WORKSPACE/.dev/features/$FEATURE"
SPEC_PATH="$FEATURE_DIR/spec.md"
PLAN_PATH="$FEATURE_DIR/plan.md"
```

Parse mode:
- `--smoke`: Basic health check only (skip full suite)
- Default: Full test suite (unit + integration + e2e)

Load test configuration:
```bash
REPOS=$(echo "$INIT" | jq -r '.repos | keys[]')
# For each repo: test commands, coverage thresholds, test directories
```
</step>

<step name="RUN_TESTS">
Execute the full test suite following the test pyramid.

**Test Pyramid** (target distribution):
- **80% Unit tests**: Pure logic, no I/O, no network, no database
  - Fast (<1s per test), deterministic, isolated
  - Test functions/methods with known inputs and expected outputs
- **15% Integration tests**: API boundaries, database queries, service interactions
  - Test real connections with controlled fixtures
  - Reset state between tests
- **5% E2E tests**: Critical user flows only
  - Test the most important happy paths end-to-end
  - Keep minimal — these are slow and fragile

**Execution order:**
1. Unit tests first (fast feedback)
2. Integration tests second (if units pass)
3. E2E tests last (if integration passes)

For each repo in scope:
```bash
# Run test commands from .dev.yaml or package.json/Makefile conventions
# Capture: pass count, fail count, skip count, coverage %
```

**Failure handling:**
- On unit test failure: stop, report failing test with full error output
- On integration test failure: check if it's an environment issue (DB down, port conflict) vs code issue
- On e2e test failure: capture screenshots/logs if available, report the failing flow

**Coverage check:**
- Compare current coverage to previous baseline
- Coverage must not decrease — warn if it drops
- Do not enforce arbitrary thresholds — track direction, not absolute numbers
</step>

<step name="PROVE_IT">
For bug fixes: the Prove-It Pattern. This step applies when the feature is a bug fix or when specific bugs were found during development.

**The 5-step Prove-It cycle:**

1. **Write reproduction test**: Create a test that exercises the exact bug scenario
   - Use the bug report's reproduction steps as the test structure
   - The test asserts the CORRECT behavior (what should happen after the fix)

2. **Confirm test FAILS**: Run the reproduction test BEFORE applying any fix
   - It MUST fail — if it passes, the test doesn't actually reproduce the bug
   - If it passes: rewrite the test to more precisely target the bug

3. **Apply fix**: Implement the minimum change to fix the bug
   - Keep the fix focused — no drive-by refactoring
   - The fix should make the reproduction test pass

4. **Confirm test PASSES**: Run the reproduction test after the fix
   - It MUST pass — if it still fails, the fix is incomplete
   - Run it multiple times if the bug was intermittent

5. **Run full suite**: Check for regressions
   - All existing tests must still pass
   - The new reproduction test becomes a permanent regression guard
</step>

<step name="SMOKE">
Basic health verification. Used with --smoke flag or as a quick sanity check.

**Smoke checks:**
1. Health endpoint returns 200 (if applicable)
   ```bash
   # curl -sf <health_endpoint> && echo "PASS" || echo "FAIL"
   ```

2. Core functionality responds correctly
   - Send a minimal valid request to the primary API/function
   - Verify response shape and status (not full content validation)

3. No new error types in logs
   - Check application logs for ERROR/FATAL entries
   - Compare against known/expected errors
   - Flag any new error patterns

Smoke is pass/fail — no partial credit:
```
Smoke: PASS (3/3 checks)
  [x] Health endpoint: 200 OK
  [x] Core request: valid response
  [x] Error logs: no new errors
```

Or:
```
Smoke: FAIL (2/3 checks)
  [x] Health endpoint: 200 OK
  [ ] Core request: 500 Internal Server Error
  [x] Error logs: no new errors
```
</step>

<step name="REPORT">
Generate test report and update state.

```bash
mkdir -p "$FEATURE_DIR"
# Write test-report.md
```

Report content:
```markdown
# Test Report: <FEATURE>
Date: <DATE>
Mode: <full|smoke>

## Results
| Category | Pass | Fail | Skip | Coverage |
|----------|------|------|------|----------|
| Unit     | <N>  | <N>  | <N>  | <N>%     |
| Integration | <N> | <N> | <N> | —     |
| E2E      | <N>  | <N>  | <N>  | —        |

## Failures
<list of failing tests with error output, if any>

## Coverage Delta
Previous: <N>% -> Current: <N>% (<+/-N>%)

## Verdict
<PASS: all tests green, coverage stable>
<FAIL: N failures, see above>
```

State update (@references/shared-patterns.md#state-update): phase=`test`

Checkpoint (@references/shared-patterns.md#checkpoint):
```bash
node "$DEVFLOW_BIN" checkpoint \
  --action "test" \
  --summary "Tests $VERDICT for $FEATURE: $PASS_COUNT pass, $FAIL_COUNT fail"
```

Output:
```
Tests <PASS|FAIL>: <FEATURE>
  Unit: <pass>/<total>
  Integration: <pass>/<total>
  E2E: <pass>/<total>
  Coverage: <N>% (<delta>)

-> Next: /devflow review <FEATURE>
```

If FAIL:
```
-> Fix failures, then re-run: /devflow test <FEATURE>
```
</step>

</process>

<anti_rationalization>

| Rationalization | Reality |
|---|---|
| "The tests pass locally" | CI is the only truth. |
| "It works now, no need for regression test" | It'll break again without a guard. |
| "Snapshot tests are fine" | Snapshot tests hide changes instead of verifying behavior. |
| "I'll just skip this flaky test" | Flaky tests erode trust. Fix or remove. |

**Red Flags:**
- Skipping or disabling failing tests instead of fixing them
- Bug fixes without a reproduction test (Prove-It Pattern)
- Tests that depend on execution order of other tests
- Mocking everything — tests that test mocks, not behavior
- Ignoring coverage decreases

**Verification:**
- [ ] All tests pass (zero failures)
- [ ] Coverage has not decreased from baseline
- [ ] Bug fixes include a reproduction test (Prove-It Pattern)
- [ ] No skipped or disabled tests without documented reason
- [ ] State updated to phase=test

</anti_rationalization>
</output>
