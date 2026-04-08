# Skill: debug

<purpose>Structured debugging: reproduce, localize, reduce, fix, guard, verify. Every investigation step follows hypothesis-action-result-lesson cycle. No guessing.</purpose>
<core_principle>Hypothesize before acting. Understand WHY before moving on. Debug sessions produce reusable experience patterns that prevent future wrong turns.</core_principle>

<process>
<step name="INIT" priority="first">
Initialize debug session, load context and prior experience.

```bash
# Auto-discover devflow CLI (marketplace or local install)
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)

INIT=$(node "$DEVFLOW_BIN" init debug)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
FEATURE=$(echo "$INIT" | jq -r '.feature.name')
WIKI_DIR=$(echo "$INIT" | jq -r '.wiki_dir // empty')
TOPIC="$1"
```

If no topic provided, ask: "What are you investigating? (e.g., deploy-stuck, bench-regression, accuracy-drop)"

Extract context:
```bash
CURRENT_TAG=$(echo "$INIT" | jq -r '.feature.current_tag')
VAULT=$(echo "$INIT" | jq -r '.vault // empty')
DEVLOG_GROUP=$(echo "$INIT" | jq -r '.devlog.group // empty')
VAULT_CONFIGURED=$( [ -n "$VAULT" ] && [ "$VAULT" != "null" ] && echo "true" || echo "false" )
```

Load prior experience:
- Experience notes matching topic (`experience/{topic}-patterns.md`) -- known root causes narrow scope
- If vault NOT configured, check `.dev/features/` for local debug notes

**Auto-load wiki knowledge** (semantic matching):
1. If `$WIKI_DIR` is set and exists, read `$WIKI_DIR/index.md`
2. Match pages by: filename contains topic keywords, OR index summary mentions related components
3. Read content of matched pages (up to 5 pages -- debug needs speed, keep context lean)
4. Focus on: architecture of failing component, known interactions, performance characteristics
5. Store as `WIKI_CONTEXT` for use in INVESTIGATE step
</step>

<step name="REPRODUCE">
Establish a reliable reproduction before investigating.

1. **Capture the symptom**: exact error message, log snippet, or behavioral description
2. **Establish reproduction steps**: minimal sequence to trigger the issue
3. **Confirm reproducibility**: run reproduction at least twice
   - If intermittent: note frequency, timing patterns, environmental factors
   - If consistent: proceed immediately to INVESTIGATE

For regressions (worked before, broken now):
```bash
# Use git bisect to find the breaking commit
git bisect start
git bisect bad HEAD
git bisect good <last_known_good_commit>
# Binary search through commits
git bisect run <test_command>
```

Output: confirmed symptom + reproduction steps, or bisect result pointing to specific commit.
</step>

<step name="INVESTIGATE">
Hypothesis-driven investigation cycle. Each iteration follows this structure:

```
HYPOTHESIS: <what you think is causing the issue and why>
ACTION:     <specific command or check to validate/refute>
RESULT:     <what actually happened>
LESSON:     <what this tells us, narrows the search space>
```

Investigation actions as needed:
- Read logs: `kubectl logs`, application logs, system journals
- Check state: `kubectl describe`, `nvidia-smi`, process lists
- Inspect code: Read source at the point of failure, check recent changes
- Compare: diff with known-good state, check environment differences
- Test hypothesis: modify config, add instrumentation, restart component

**Rules**:
- Maximum 5 iterations before stepping back and reassessing approach
- If hypothesis was wrong, record WHY it was wrong (prevents repeating)
- If 3 consecutive hypotheses fail, consider: is the symptom itself misleading?
- Never change more than one variable per iteration

**Localization**: narrow from system to component to function to line:
1. Which system? (network, GPU, application, OS)
2. Which component? (scheduler, model, cache, API)
3. Which function/module? (specific file and code path)
4. Which line/config? (exact root cause)

**Reduction**: once localized, create minimal reproduction:
- Strip away unrelated components
- Simplify config to minimum that triggers the bug
- This minimal case becomes the test case for the fix
</step>

<step name="FIX">
Apply the fix with discipline.

1. **State the root cause clearly**: one sentence explaining WHY, not just WHAT
2. **Implement the fix**: change the minimum necessary code/config
3. **Verify the fix**: run the reproduction steps -- must no longer trigger the issue
4. **Check for side effects**: run related tests, check adjacent functionality
5. **Atomic commit**: `fix(<scope>): <root_cause_summary>`
</step>

<step name="GUARD">
Prevent recurrence through automated checks.

1. **Offer learned hook** in `.dev.yaml`:
   ```
   Save as learned hook? This creates an automatic check for future builds/deploys.
   Name: <suggested_name>
   Trigger: <suggested_phase>
   Rule: <human-readable check>
   ```

   If yes, append to `.dev.yaml` feature `hooks.learned[]`:
   ```yaml
   - name: <name>
     trigger: <phase>
     added: <today>
     rule: <description>
   ```

2. **Offer wiki update** if root cause reveals system internals worth documenting

3. **Offer project-level hook promotion** (only if step 1 saved a hook):
   ```
   Promote to project-level hook? Applies to ALL features. [y/N]
   ```
   Default: No (feature-level is safer).
</step>

<step name="VERIFY">
Confirm the fix holds and the system is healthy.

1. Run the original reproduction steps -- must pass
2. Run any existing test suite for the affected component
3. If deploy-related: run `/devflow verify --smoke`
4. If bench-related: run quick comparison against previous tag

Output:
```
Debug Resolution: $TOPIC
  Root Cause: <one-line summary>
  Fix: <commit hash> <commit message>
  Guard: <hook name or "none">
  Verified: <test results>
```
</step>

<step name="EXPERIENCE_SINK">
Save debug lessons to experience notes for future sessions.

**If vault configured** (`VAULT_CONFIGURED == "true"`):
```bash
EXPERIENCE_DIR="$VAULT/$DEVLOG_GROUP/experience"
```

Auto-create/append to `$EXPERIENCE_DIR/${TOPIC}-patterns.md`:
```markdown
---
date: <TODAY>
project: $FEATURE
tags: [debug, $TOPIC]
---

# $TOPIC Patterns

## Pattern: <root_cause_name>
**Symptom**: <what was observed>
**Root Cause**: <why it happened>
**Fix**: <what was done>
**Dead Ends**: <investigation directions that looked promising but were wrong, and why>
**Prevention**: <learned hook name or manual check>
```

Rules:
- If note already exists, APPEND a new `## Pattern:` section
- Dead Ends section is critical -- saves future debug time
- Show user what was saved and offer to edit

**If vault NOT configured**:
Save to `.dev/features/$FEATURE/debug-${TOPIC}.md` instead. Same format.

**Auto-ingest to wiki** (if `$WIKI_DIR` is set):
1. Create/update `$WIKI_DIR/{topic}-debug-patterns.md`
2. Distill experience into reusable wiki format -- strip session-specific details
3. Add `[[wikilinks]]` to related architecture pages
4. Update `$WIKI_DIR/index.md` and `$WIKI_DIR/log.md`

Checkpoint:
```bash
node "$DEVFLOW_BIN" checkpoint \
  --action "debug" \
  --summary "Debug $TOPIC: $ROOT_CAUSE"
```
</step>
</process>

<anti_rationalization>

## Anti-Rationalization Table

| Temptation | Reality Check |
|---|---|
| "I'll just try random things" | Hypothesize before acting. Random changes destroy signal. |
| "It works now" | Understand WHY before moving on. Intermittent bugs return. |
| "It's probably X" | Prove it. Check the evidence. Gut feeling is not diagnosis. |
| "Let me change multiple things at once" | One variable per iteration or you can't attribute the fix. |
| "The logs don't show anything" | Wrong log level, wrong time window, or wrong component. Expand search. |
| "It must be an environment issue" | Reproduce it. If you can't, you don't understand it. |

## Red Flags

- Changing code without a hypothesis -- STOP and think first
- Same hypothesis tested twice -- review your investigation log
- More than 5 iterations without progress -- step back, reassess the problem framing
- Fix applied without understanding root cause -- this is a time bomb
- "It works on my machine" -- document the environmental difference

## Verification Checklist

- [ ] Root cause stated in one clear sentence
- [ ] Fix is minimal and targeted
- [ ] Reproduction steps no longer trigger the issue
- [ ] Side effects checked
- [ ] Experience note saved with dead ends documented
- [ ] Learned hook offered (if applicable)

</anti_rationalization>
