# Skill: plan (PLAN)

<purpose>
Decompose a feature spec into small, verifiable tasks with dependency ordering, wave-based grouping, and acceptance criteria. Read-only analysis phase — no code changes.
</purpose>

<core_principle>
Plans must be executable by independent subagents. Each task is self-contained with explicit inputs, outputs, and constraints. Wave ordering ensures correctness across repos. A written plan survives session boundaries and context limits.
</core_principle>

<process>

<step name="INIT" priority="first">
Initialize workflow context and validate prerequisites.

```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)

INIT=$(node "$DEVFLOW_BIN" init plan)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
PROJECT=$(echo "$INIT" | jq -r '.feature.name')
FEATURE="$1"
```

Gate: `.dev/features/${FEATURE}/spec.md` must exist. If not:
- "No spec found. Run `/devflow spec $FEATURE` first."
</step>

<step name="KNOWLEDGE_CHECK">
Auto-check wiki for pages related to the feature.

**Semantic matching**:
1. Read `wiki/index.md` for the full page catalog
2. Match pages by: filename keywords, index summary, tags, spec scope repos, component names
3. Load ALL matched pages (typically 3-10 pages for a medium feature)

**Freshness check** per matched page:
- **FRESH** (repo_commits match current HEAD) → load into planner context
- **STALE** (commits differ) → auto-refresh inline, then load
- **MISS** (no relevant pages) → auto-ingest inline, then load

```bash
WIKI_DIR=$(echo "$INIT" | jq -r '.wiki_dir')
# Read index, match by feature keywords + spec scope + component names
# Load matched wiki pages into KNOWLEDGE_CONTENT
```

Auto-learn for STALE/MISS (inline, focused):
1. STALE: delta research (git diff between old/new commits), update page, update frontmatter
2. MISS: full research (Glob/Grep/Read in base worktrees), create new pages
3. Re-load now-current pages into `KNOWLEDGE_CONTENT`
4. Report: `Auto-refreshed: 2 STALE pages, 1 new page`

Scope limit: if >5 pages need auto-learn, warn and suggest `/devflow learn` first.

**Key principle**: Cast a wide net. Better to load 2 extra marginally relevant pages than miss one critical one. The planner can ignore irrelevant context but cannot use knowledge it never received.
</step>

<step name="LOAD_CONTEXT">
Read spec, user decisions, and current repo state. This is a read-only step — do NOT write code.

```bash
SPEC_PATH="$WORKSPACE/.dev/features/${FEATURE}/spec.md"
CONTEXT_PATH="$WORKSPACE/.dev/features/${FEATURE}/context.md"
```

1. Parse spec: Goal, Scope (repos/files/change types), Constraints, Verification Criteria
2. Load context.md if available: locked decisions (D-01, D-02...), deferred ideas, constraints
3. For each repo in scope: read target files in dev_worktree, read base_ref version, collect existing diff
4. Load invariants from .dev.yaml (source_restriction, build_compat_check)
</step>

<step name="GENERATE_PLAN">
Generate the task breakdown. Enter plan mode — read only, no code changes.

Spawn agent: **my-dev-planner** with full context:

<agent_prompt>
You are generating an implementation plan for feature "$FEATURE".

## Spec
<full_spec_content>

## User Decisions (from context.md, if available)
<LOCKED decisions — do NOT override. Honor every D-xx ID exactly.>

## Domain Knowledge (from wiki)
<wiki page content>

## Current State
<for each repo: file contents, existing diffs, base_ref versions>

## Constraints
- source_restriction: <value>
- build_compat_check: <value>
- Cross-repo dependencies from spec

## Output Format

```markdown
# Implementation Plan: <FEATURE>
Created: <DATE> | Tasks: <N> | Waves: <W>

## Wave 1: <description>
### Task 1: <title>
- **Status**: pending
- **Repo**: <name> | **Worktree**: <path>
- **Files**: <list>
- **Action**: <detailed description>
- **Acceptance Criteria**: <specific, testable condition>
- **Verification**: <command to run>
- **Depends On**: none
- **Delegation**: subagent|direct

## Cross-Repo Compatibility Check
- [ ] <checks>

## Risk Assessment
- <risk>: <mitigation>
```

Rules:
- Tasks in same wave: NO mutual dependencies, NO shared files
- Cross-repo API: producer wave BEFORE consumer wave
- Each task: max ~200 lines changed, self-contained with explicit context
- Every task MUST have acceptance criteria and verification command
- "subagent" for implementation, "direct" for simple config changes
</agent_prompt>

Wait for planner result. Store as `DRAFT_PLAN`.
</step>

<step name="VERIFY_PLAN">
Verify plan quality before saving. Check these 8 dimensions:

1. **Completeness**: covers all spec files/repos
2. **Wave ordering**: cross-repo dependencies correct
3. **Task granularity**: each task ≤200 lines
4. **Self-containment**: no implicit knowledge — every task has explicit inputs
5. **Constraint compliance**: honors locked decisions, invariants
6. **No wave conflicts**: no shared files in same wave
7. **Missing tasks**: spec scope fully covered
8. **Verification coverage**: every task has a testable acceptance criterion

| Size | Files | Notes |
|------|-------|-------|
| XS | 1 | Single function |
| S | 1-2 | One endpoint |
| M | 3-5 | One feature slice |
| L | 5-8 | Break down further |
| XL | 8+ | Too large — must split |

If issues found: revise plan (max 1 revision loop). If still failing, present to user with specific concerns.
</step>

<step name="SAVE">
Save verified plan and update state.

```bash
mkdir -p "$WORKSPACE/.dev/features/${FEATURE}"
# Write DRAFT_PLAN to plan.md
```

State update (@references/shared-patterns.md#state-update): phase=`plan`, plan_progress=`0/$TASK_COUNT`

Checkpoint (@references/shared-patterns.md#checkpoint):
```bash
node "$DEVFLOW_BIN" checkpoint \
  --action "plan" \
  --summary "Plan created for $FEATURE: $TASK_COUNT tasks in $WAVE_COUNT waves"
```

Output:
```
Plan saved: .dev/features/<FEATURE>/plan.md
  Tasks: <N> across <W> waves
  Checkpoints every 2-3 tasks

→ Next: /devflow code <FEATURE>
```
</step>

</process>

<anti_rationalization>

| Rationalization | Reality |
|---|---|
| "I can just start coding" | Plans save 3x the time they cost. Without a plan, you'll redo work when dependencies clash. |
| "The plan will slow me down" | Debugging without a plan is what slows you down. The plan is the fast path. |
| "I'll plan in my head" | Head-plans don't survive session boundaries, context compression, or agent handoffs. Write it down. |
| "The spec is clear enough to implement directly" | A spec defines WHAT. A plan defines HOW, in what ORDER, and what DEPENDS on what. |
| "Plans become outdated quickly" | A plan that needs updating is still better than no plan. Update it as you go. |

**Red Flags:**
- Writing code during the planning phase (this is read-only)
- Tasks without acceptance criteria
- XL-sized tasks (8+ files) that should be split
- Missing dependency ordering between cross-repo tasks
- Planner ignoring locked decisions from context.md
- No verification commands on tasks

**Verification:**
- [ ] All spec scope files covered by at least one task
- [ ] Every task has acceptance criteria and verification command
- [ ] No task touches more than 5 files
- [ ] Wave ordering respects cross-repo dependencies
- [ ] Locked decisions from context.md honored
- [ ] Plan approved by verification check (or user)
- [ ] State updated to phase=plan

</anti_rationalization>
