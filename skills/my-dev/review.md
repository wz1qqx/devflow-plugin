# Skill: review (REVIEW)

<purpose>
Five-axis code review of all changes across repos for a feature. Quality gate before shipping — catch issues while context is fresh, not after a failed deploy.
</purpose>

<core_principle>
Working code and good code are different things. Every review checks all five axes with severity labels. No rubber-stamping, no deferring cleanup, no skipping AI-generated code.
</core_principle>

<process>

<step name="INIT" priority="first">
Initialize workflow context, load feature spec, wiki knowledge, and review prerequisites.

```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)

INIT=$(node "$DEVFLOW_BIN" init review)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
PROJECT=$(echo "$INIT" | jq -r '.feature.name')
FEATURE="$1"
```

Load context:
```bash
FEATURE_DIR="$WORKSPACE/.dev/features/$FEATURE"
SPEC_PATH="$FEATURE_DIR/spec.md"
WIKI_DIR=$(echo "$INIT" | jq -r '.wiki_dir // empty')
REPOS=$(echo "$INIT" | jq -r '.repos | keys[]')
```

1. Read `$SPEC_PATH` — the feature specification with locked decisions and verification criteria
2. Load wiki knowledge:
   - Read `$WIKI_DIR/index.md` for page catalog
   - Match pages by: spec scope repos, component names, feature keywords
   - Read matched pages (up to 10) — store as `WIKI_CONTEXT`
3. Load invariants from `.dev.yaml` (source_restriction, build_compat_check)

Gate: At least one task in `$FEATURE_DIR/plan.md` must be `done`.
If no plan exists, check if there are any diffs in dev_worktrees (ad-hoc review mode).
</step>

<step name="COLLECT_DIFFS">
Gather all diffs across repos in the feature scope.

For each repo in project:
```bash
DEV_WORKTREE=$(echo "$INIT" | jq -r ".repos.$REPO.dev_worktree")
BASE_REF=$(echo "$INIT" | jq -r ".repos.$REPO.base_ref")

DIFF=$(git -C "$WORKSPACE/$DEV_WORKTREE" diff "$BASE_REF"..HEAD)
STAT=$(git -C "$WORKSPACE/$DEV_WORKTREE" diff --stat "$BASE_REF"..HEAD)
LOG=$(git -C "$WORKSPACE/$DEV_WORKTREE" log --oneline "$BASE_REF"..HEAD)
```

Aggregate into a review package:
- Total files changed, insertions, deletions per repo
- Full diff content for each repo
- Commit log per repo

Gate: If no diffs found across any repo, abort: "No changes to review."
</step>

<step name="SPAWN_REVIEWER">
Spawn the reviewer agent with spec, wiki knowledge, and full diffs.

Spawn agent: **my-dev-reviewer**
Model: resolved via `node "$DEVFLOW_BIN" resolve-model my-dev-reviewer`
Prompt:
<agent_prompt>
You are reviewing code changes for feature "$FEATURE" in project "$PROJECT".

## Spec
<spec_content from $SPEC_PATH>

## Domain Knowledge (from wiki)
<matched wiki page content>

## Changes by Repo
<for each repo: diff stat + full diff + commit log>

## Active Invariants
- source_restriction: $SOURCE_RESTRICTION
- build_compat_check: $BUILD_COMPAT

## Five Review Axes

Evaluate EVERY axis. For each finding, assign severity:
- **Critical**: blocks merge — must fix before proceeding
- **Important**: should fix — real risk if left unaddressed
- **Suggestion**: optional improvement — nice to have

### 1. Correctness
- Does the implementation match the spec? Are locked decisions (D-xx) honored?
- Are edge cases handled? Empty inputs, nulls, boundary values, concurrent access?
- Are error paths complete? No silent failures, no swallowed exceptions?
- Do return types and contracts match across call sites?

### 2. Readability
- Are names clear and intention-revealing? No abbreviations without context?
- Is control flow straightforward? No unnecessary cleverness or deep nesting?
- Are comments explaining WHY, not WHAT?
- Would a new team member understand this code in 5 minutes?

### 3. Architecture
- Does the code follow established patterns in the codebase?
- Are boundaries clean? No leaking abstractions, no god objects?
- Is the abstraction level right? Not too abstract, not too concrete?
- Are cross-repo interfaces minimal and well-defined?

### 4. Security
- Is all user input validated before processing?
- Are secrets safe? No hardcoded credentials, no leaked tokens in logs?
- Is authentication/authorization checked at every entry point?
- Are database queries parameterized? No string interpolation in queries?

### 5. Performance
- Any N+1 query patterns? Loops with database calls inside?
- Any unbounded operations? Missing pagination, unlimited result sets?
- Are expensive computations cached when appropriate?
- Any unnecessary allocations in hot paths?

## Output Format

```markdown
# Code Review: $FEATURE

Date: <today>
Reviewer: automated (my-dev-reviewer)

## Summary
| Repo | Files Changed | Insertions | Deletions |
|------|--------------|------------|-----------|

## Findings

### Critical (blocks merge)
- [ ] [AXIS] <file>:<line> — <finding>

### Important (should fix)
- [ ] [AXIS] <file>:<line> — <finding>

### Suggestion (optional)
- [ ] [AXIS] <file>:<line> — <finding>

## Axis Coverage
| Axis | Checked | Findings |
|------|---------|----------|
| Correctness | yes | N |
| Readability | yes | N |
| Architecture | yes | N |
| Security | yes | N |
| Performance | yes | N |

## Verdict
PASS | PASS_WITH_WARNINGS | FAIL
<reasoning>
```
</agent_prompt>

Wait for reviewer result. Store as `REVIEW_RESULT`.
</step>

<step name="AUTO_FIX">
Attempt automatic fixes for deterministic CRITICAL findings only.

Parse review findings. For each CRITICAL item:

1. Extract: file path, line number, axis, issue description, suggested fix
2. If the fix is deterministic (e.g., remove hardcoded secret, add missing null check, fix off-by-one):
   - Read the file at the specified path and line
   - Apply the minimal fix using Edit tool
   - Run relevant tests to verify the fix does not break anything:
     ```bash
     # Run tests scoped to the changed file/module
     ```
   - Commit with message: `fix($FEATURE): <finding_summary>`

3. If the fix is non-trivial, ambiguous, or requires design decisions: skip auto-fix, leave for user

Report auto-fix results:
```
Auto-fixed: N/M CRITICAL findings
Remaining: K findings require manual attention
```

If any auto-fix broke tests, revert and mark as manual.
</step>

<step name="SAVE">
Save the review report and route based on verdict.

```bash
mkdir -p "$WORKSPACE/.dev/features/${FEATURE}"
cat > "$WORKSPACE/.dev/features/${FEATURE}/review.md" << 'REVIEW_EOF'
<REVIEW_RESULT>
REVIEW_EOF
```

Based on verdict:

**PASS**:
```
Review: PASS
All 5 axes checked. No blocking issues.

Next: /devflow ship
```

**PASS_WITH_WARNINGS**:
```
Review: PASS_WITH_WARNINGS
N warnings found (see .dev/features/$FEATURE/review.md)
All CRITICAL issues resolved. Important findings documented.

Next: /devflow ship (or fix warnings first)
```

**FAIL**:
```
Review: FAIL
M critical issues remain. Must fix before proceeding.

Critical issues:
  1. [AXIS] <file>:<line> - <issue>
  ...

Next: Fix issues, then /devflow code $FEATURE (with specific fix tasks)
```

State update (@references/shared-patterns.md#state-update): stage=`review`

Checkpoint (@references/shared-patterns.md#checkpoint):
```bash
node "$DEVFLOW_BIN" checkpoint \
  --action "review" \
  --summary "Review $VERDICT for $FEATURE: $CRITICAL_COUNT critical, $IMPORTANT_COUNT important, $SUGGESTION_COUNT suggestions"
```
</step>

<step name="KNOWLEDGE_SINK">
@references/shared-patterns.md#experience-sink

Detection criteria: review findings contain recurring or architecture-level patterns applicable to future development, OR any Important-severity finding about architectural issues, OR any finding that affects cross-repo compatibility.

Persist to wiki:
- Create/update `$WIKI_DIR/<pattern>.md` with pattern description, examples, rationale
- Update `$WIKI_DIR/index.md` and `$WIKI_DIR/log.md`
- Context fields: `feature=$FEATURE, date=<TODAY>, verdict=$VERDICT`

Note: Target is `wiki/` not `experience/` — these are reusable design patterns, not debugging lessons.
</step>

</process>

<anti_rationalization>

| Rationalization | Reality |
|---|---|
| "It works, ship it" | Working code and good code are different things. "Works" is the minimum bar, not the finish line. |
| "LGTM" | Rubber-stamping helps no one. Every review must check all 5 axes with severity labels. |
| "I'll fix it in the next PR" | Later never comes. Fix it now or track it with a severity label. |
| "AI-generated code looks fine" | AI code needs MORE scrutiny, not less — it is confident even when wrong. Review it harder. |

**Red Flags:**
- Rubber-stamping without checking all 5 axes
- Deferring cleanup to a future PR that never arrives
- Not reviewing AI-generated code with the same rigor as human code
- Findings without severity labels (Critical / Important / Suggestion)
- Skipping the axis coverage table in the review output
- Approving with unresolved CRITICAL findings

**Verification:**
- [ ] All 5 axes checked (correctness, readability, architecture, security, performance)
- [ ] Every finding has a severity label (Critical, Important, Suggestion)
- [ ] All CRITICAL issues resolved or auto-fixed
- [ ] Axis coverage table is complete in review output
- [ ] Verdict is justified with reasoning
- [ ] State updated to stage=review

</anti_rationalization>
</output>
