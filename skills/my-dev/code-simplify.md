# Skill: code-simplify

<purpose>Reduce complexity while preserving exact behavior. One change at a time, test after each, revert if not genuinely simpler. Inspired by Chesterton's Fence.</purpose>
<core_principle>Before removing anything, understand why it exists. Simpler means easier to understand, not fewer lines. A 1-line nested ternary is not simpler than a 5-line if/else. Complexity has a reason -- find it before eliminating it.</core_principle>

<process>
<step name="INIT" priority="first">
Load workspace and identify target scope.

```bash
# Auto-discover devflow CLI (marketplace or local install)
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)

INIT=$(node "$DEVFLOW_BIN" init code-simplify)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
FEATURE=$(echo "$INIT" | jq -r '.feature.name')
TARGET="$1"
```

Gate: `TARGET` must be provided. Can be:
- A file path: simplify that specific file
- A directory: scan for complexity hotspots
- A function/class name: find and simplify that symbol
- "recent": simplify files changed in last 5 commits

If no TARGET: "What should I simplify? (file path, directory, function name, or 'recent')"

Establish baseline:
```bash
# Run existing tests to confirm current behavior
TEST_CMD=$(echo "$INIT" | jq -r '.verify.test_cmd // empty')
if [ -n "$TEST_CMD" ]; then
  echo "Running baseline tests..."
  bash -c "$TEST_CMD"
  BASELINE_EXIT=$?
  if [ $BASELINE_EXIT -ne 0 ]; then
    echo "[WARN] Tests already failing. Simplification will preserve current behavior, not fix bugs."
  fi
fi
```
</step>

<step name="UNDERSTAND">
Chesterton's Fence -- before removing or changing, understand why it exists.

For each file/function in scope:

1. **Check git blame**: Who wrote it? When? What was the commit message?
   ```bash
   git -C "$WORKSPACE" blame --date=short <file>
   git -C "$WORKSPACE" log --oneline -5 -- <file>
   ```

2. **Read the code thoroughly**: understand the intent, not just the syntax

3. **Identify the purpose** of complex sections:
   - Is this complexity handling edge cases? (likely necessary)
   - Is this complexity from accumulated patches? (candidate for cleanup)
   - Is this complexity from premature optimization? (measure before simplifying)
   - Is this complexity from defensive coding? (may be load-bearing)

4. **Check for consumers**: Who calls this? What depends on the current behavior?
   ```bash
   # Find all references to the function/symbol
   # Check test files for expected behavior
   ```

5. **Document understanding**: before any change, write a one-line summary of what the code does and WHY it's complex.

Rule: If you cannot explain WHY something is complex, do NOT simplify it yet. Research more.
</step>

<step name="IDENTIFY">
Catalog complexity patterns and prioritize by impact.

Scan target code for these patterns:

| Pattern | Simplification | Risk |
|---|---|---|
| Deep nesting (>3 levels) | Guard clauses, early returns | Low |
| Long functions (>50 lines) | Extract helper functions | Low |
| Nested ternaries | Convert to if/else | Low |
| Generic names (`data`, `temp`, `obj`) | Descriptive names | Low |
| Dead code (unreachable branches) | Remove with git blame check | Medium |
| Copy-paste duplication | Extract shared function | Medium |
| God object (does too many things) | Split into focused modules | High |
| Premature abstraction | Inline until pattern is clear | High |

**Prioritize**:
1. High-confidence, low-risk changes first (guard clauses, naming, dead code)
2. Medium changes next (extraction, deduplication)
3. High-risk changes last and only with thorough testing

**Rule of 500**: If any file exceeds 500 lines, flag it as a split candidate.
Files >800 lines are mandatory split targets.

Output a numbered simplification plan:
```
Simplification Plan:
  1. [LOW]  file.py:42 -- deep nesting -> guard clauses
  2. [LOW]  file.py:78 -- nested ternary -> if/else
  3. [MED]  file.py:120-180 -- extract helper function
  4. [MED]  file.py:200-205 -- dead code (unreachable after guard)
  5. [HIGH] utils.py -- 650 lines, split into focused modules
```

Ask user to confirm plan before proceeding.
</step>

<step name="SIMPLIFY">
Execute one change at a time, test after each.

For each item in the plan:

1. **Make exactly one change** -- never combine simplifications
2. **Run tests immediately**:
   ```bash
   if [ -n "$TEST_CMD" ]; then
     bash -c "$TEST_CMD"
     if [ $? -ne 0 ]; then
       echo "[FAIL] Tests broke. Reverting change."
       git -C "$WORKSPACE" checkout -- <file>
       echo "Skipping this simplification. Moving to next."
       continue
     fi
   fi
   ```
3. **Commit the change** (atomic, one simplification per commit):
   ```
   refactor(<scope>): <what was simplified and why>
   ```
4. **Move to next item**

**Guard clause transformation** example:
```
# Before (nested):
def process(data):
    if data is not None:
        if data.valid:
            if data.ready:
                return do_work(data)
    return None

# After (guard clauses):
def process(data):
    if data is None:
        return None
    if not data.valid:
        return None
    if not data.ready:
        return None
    return do_work(data)
```

**Function extraction** rules:
- Extract only when the extracted function has a clear, descriptive name
- If you can't name it well, don't extract it
- Extracted function should be <=30 lines
- Pass explicit parameters, avoid closure over mutable state
</step>

<step name="VERIFY">
Confirm the result is genuinely simpler.

**Quantitative checks**:
```bash
# Line count comparison
echo "Before: $(git -C "$WORKSPACE" show HEAD~${NUM_CHANGES}:<file> | wc -l) lines"
echo "After:  $(wc -l < <file>) lines"

# Nesting depth (rough check)
echo "Max nesting before: $(git -C "$WORKSPACE" show HEAD~${NUM_CHANGES}:<file> | awk '{print gsub(/  /,"")}' | sort -n | tail -1)"
echo "Max nesting after:  $(awk '{print gsub(/  /,"")}' <file> | sort -n | tail -1)"
```

**Qualitative check** -- ask yourself:
- Is each function <=50 lines?
- Is each file <=500 lines (800 absolute max)?
- Can a new developer understand this in one reading?
- Are names descriptive and consistent?
- Is the control flow linear (few branches, early returns)?

**If NOT genuinely simpler**: revert the change.
```bash
# Revert specific commits if they made things worse
git -C "$WORKSPACE" revert --no-edit <commit>
```

The goal is clarity, not cleverness. Sometimes the original code was already the simplest form.

**Final test run**:
```bash
if [ -n "$TEST_CMD" ]; then
  echo "Final test run..."
  bash -c "$TEST_CMD"
fi
```

Output:
```
Simplification: $TARGET
  Changes: N simplifications applied, M skipped, K reverted
  Lines: before -> after (delta)
  Files: <list of modified files>
  Tests: PASS/FAIL
  Commits: <list of commit hashes>
```

Checkpoint:
```bash
node "$DEVFLOW_BIN" checkpoint \
  --action "code-simplify" \
  --summary "Simplify $TARGET: $NUM_CHANGES changes"
```
</step>
</process>

<anti_rationalization>

## Anti-Rationalization Table

| Temptation | Reality Check |
|---|---|
| "Fewer lines is simpler" | A 1-line nested ternary is not simpler than a 5-line if/else. |
| "I'll remove this unused code" | Check git blame first. It may be load-bearing or handle rare edge cases. |
| "Let me refactor everything at once" | One change at a time. Test after each. Batch refactors hide bugs. |
| "This abstraction is cleaner" | Premature abstraction is worse than duplication. Wait for 3 instances. |
| "The tests pass, so it's fine" | Tests passing means behavior preserved. It doesn't mean the code is simpler. |
| "I can't name this function" | If you can't name it, you don't understand it. Don't extract it yet. |

## Red Flags

- Multiple simplifications in one commit (impossible to bisect if something breaks)
- Removing code without checking git blame (Chesterton's Fence violation)
- "Simplification" that adds more abstraction layers
- Renaming without checking all references
- Simplifying test code (tests should be explicit, not DRY)
- File still >500 lines after simplification (split needed)

## Verification Checklist

- [ ] git blame checked before every removal
- [ ] Each change is a separate commit
- [ ] Tests run and pass after each change
- [ ] Functions <=50 lines
- [ ] Files <=500 lines (800 absolute max)
- [ ] No nested ternaries
- [ ] Max nesting depth <=3
- [ ] Names are descriptive
- [ ] Reverted changes that didn't improve clarity

</anti_rationalization>
