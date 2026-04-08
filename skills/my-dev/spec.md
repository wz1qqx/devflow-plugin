# Skill: spec (DEFINE)

<purpose>
Surface gray areas in requirements, lock implementation decisions with the user, and generate a structured feature specification. Merges the "discuss" and "specify" steps into one flow.

You are a thinking partner, not an interviewer. The user is the visionary — you are the builder.
</purpose>

<core_principle>
Capture decisions before a single line of code is written. This is the cheapest point to make expensive decisions. A 15-minute spec prevents hours of rework.
</core_principle>

<process>

<step name="INIT" priority="first">
Initialize workflow context and load project configuration.

```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)

INIT=$(node "$DEVFLOW_BIN" init spec)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
PROJECT=$(echo "$INIT" | jq -r '.feature.name')
FEATURE="$1"  # Feature name from arguments
```

Validate: `FEATURE` must be non-empty. If missing, prompt user: "Which feature? Provide a short kebab-case name."

Gate: `.dev.yaml` must exist at `$WORKSPACE`. If not, abort with: "Run `/devflow init` first."
</step>

<step name="LOAD_CONTEXT">
Read project configuration, knowledge base, and any existing artifacts.

```bash
REPOS=$(echo "$INIT" | jq -r ".repos | keys[]")
WIKI_DIR=$(echo "$INIT" | jq -r '.wiki_dir // empty')
FEATURE_DIR="$WORKSPACE/.dev/features/$FEATURE"
SPEC_PATH="$FEATURE_DIR/spec.md"
CONTEXT_PATH="$FEATURE_DIR/context.md"
```

1. For each repo, collect: upstream, base_ref, dev_worktree, current diff stat
2. Load wiki knowledge (semantic matching):
   - Read `$WIKI_DIR/index.md` for page catalog
   - Match pages by: filename keywords, index summary, tags, spec scope repos
   - Read matched pages (up to 10) — store as `WIKI_CONTEXT`
   - STALE pages: auto-refresh with delta research
   - MISS: note for later, do not block spec
3. Check existing spec/context: if found, ask "Update existing or start fresh?"
4. Load STATE.md decisions (avoid re-asking resolved ones)
</step>

<step name="INTERACTIVE_QA">
Gather requirements through structured questions. Do NOT skip any mandatory question.

**Mandatory Questions** (ask one at a time, wait for response):

1. **Goal**: "What problem does this feature solve? (1-2 sentences)"
2. **Scope**: "Which repos and files are involved?"
   - For each mentioned repo, verify it exists in `.dev.yaml` repos
   - If user is unsure, suggest based on wiki pages and current diffs
3. **Constraints**: "Any API compatibility requirements? Breaking changes allowed?"
   - Cross-reference with `invariants.build_compat_check`
4. **Verification**: "How do we verify success? (smoke test, benchmark threshold, accuracy check)"
5. **Out of Scope**: "What should this feature explicitly NOT include?"

**Optional Follow-ups** (ask if relevant):
- "Cross-repo dependencies? Which repo changes must land first?"
- "Build mode implications? (Python-only = fast, Rust/C++ = rust/full)"
- "Any known risks from previous attempts?"
</step>

<step name="SURFACE_GRAY_AREAS">
Analyze collected requirements and identify decisions the user needs to make.

**Gray area identification method:**

1. Read the Goal and Scope answers
2. For each repo/file in scope, understand the change type:
   - New code → many design decisions (API shape, data structures, patterns)
   - Modification → fewer decisions (compatibility, approach)
   - Config change → minimal decisions
3. Generate **specific** gray areas (NOT generic categories):

**Good gray areas** (specific to the feature):
```
Feature: "PegaFlow L2 cache"
→ Cache storage medium (CPU DRAM vs NVMe vs hybrid)
→ Eviction policy (LRU vs session-aware vs TTL)
→ Configuration mechanism (env var vs CLI arg vs config file)
```

**Bad gray areas** (too generic — never use these):
```
→ "Performance considerations"
→ "Error handling approach"
→ "Testing strategy"
```

4. Filter out:
   - Decisions already in STATE.md
   - Decisions implied by constraints (source_restriction → no choice)
   - Technical details the user doesn't care about (planner handles those)

Present gray areas:
```
Found <N> decisions that could shape the implementation:

1. ◆ Cache storage medium — where does L2 data live?
2. ◆ Eviction policy — how do we manage cache capacity?
3. ◆ Configuration — how does the user control behavior?

Which areas do you want to discuss? (enter numbers, or 'all')
```

For each selected area:
1. Present 2-4 concrete options with trade-offs
2. Use loaded wiki content to inform options — cite specific pages
3. Let user choose or provide their own approach
4. Record as a locked decision with rationale
</step>

<step name="GENERATE_SPEC">
Generate the spec document from collected answers and locked decisions.

```markdown
# Feature Spec: <FEATURE>

Created: <TODAY_DATE>
Project: <PROJECT>
Status: draft

## Goal
<answer_1>

## Context
<knowledge_notes_summary + why_needed>

## Scope

### Repos & Files
| Repo | Worktree | Files | Change Type |
|------|----------|-------|-------------|
| <repo> | <dev_worktree> | <file_paths> | new / modify / delete |

### Out of Scope
<answer_5>

## Constraints
- API Compatibility: <answer_3>
- Build Mode: <inferred_from_file_types>
- Cross-Repo Dependencies: <if_any>
- Invariants: <active_invariants_from_config>

## Decisions (LOCKED — planner must honor these exactly)
| ID | Decision | Rationale | Area |
|----|----------|-----------|------|
| D-01 | ... | ... | ... |

## Deferred Ideas (NOT in scope)
- <idea>: deferred because <reason>

## Verification Criteria
- [ ] <smoke_criterion>
- [ ] <accuracy_criterion>
- [ ] <performance_criterion>

## Risk Assessment
- <risk>: <mitigation>
```

Present to user: "Approve this spec? (yes / edit section N / regenerate)"
</step>

<step name="SAVE">
Save approved spec and update state.

```bash
mkdir -p "$WORKSPACE/.dev/features/${FEATURE}"
# Write spec to $FEATURE_DIR/spec.md
```

State update (@references/shared-patterns.md#state-update): phase=`spec`

Checkpoint (@references/shared-patterns.md#checkpoint):
```bash
node "$DEVFLOW_BIN" checkpoint \
  --action "spec" \
  --summary "Spec created for feature: $FEATURE (D-01..D-$N locked)"
```

**Wiki persistence** (if wiki_dir configured and decisions were locked):
- Create/update `$WIKI_DIR/${FEATURE}-decisions.md` with decision sections
- Update `$WIKI_DIR/index.md` and `$WIKI_DIR/log.md`

Output:
```
Spec saved: .dev/features/<FEATURE>/spec.md
  Decisions locked: <N>
  Deferred ideas: <N>

→ Next: /devflow plan <FEATURE>
```
</step>

</process>

<scope_guardrail>
CRITICAL: No scope creep during specification.

The spec boundary is what the user defines. Discussion clarifies HOW to implement what's scoped, never WHETHER to add new capabilities.

When user suggests scope creep:
"That would be a new capability — worth its own feature.
Want me to note it as a deferred idea?
For now, let's focus on <spec scope>."
</scope_guardrail>

<anti_rationalization>

| Rationalization | Reality |
|---|---|
| "I already know what to build" | Unstated assumptions cause 80% of rework. Write them down. |
| "This is too small for a spec" | A 2-line spec is valid. No spec is not. Even a typo fix has scope. |
| "The spec will slow me down" | A 15-minute spec prevents hours of rework and re-discussion. |
| "I'll figure it out as I code" | That's called prototyping, not engineering. Prototypes become production. |
| "The user will tell me if I'm wrong" | The user shouldn't have to catch your assumptions. Surface them first. |

**Red Flags:**
- Starting to code without written requirements
- Skipping gray area discussion because something seems "obvious"
- Making undocumented architectural decisions
- Generating generic gray areas instead of feature-specific ones
- Not waiting for user response on mandatory questions

**Verification:**
- [ ] All 5 mandatory questions answered
- [ ] Gray areas surfaced and decisions locked (or explicitly deferred)
- [ ] Spec approved by user
- [ ] Decisions have rationale (not just "user chose X")
- [ ] Out-of-scope section is non-empty
- [ ] State updated to phase=spec

</anti_rationalization>
