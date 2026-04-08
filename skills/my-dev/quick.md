# Skill: quick

<purpose>Fast-path for trivial tasks (max 3 tasks). Plan + execute + atomic commit in one pass, with the same quality guarantees as the full pipeline but less ceremony.</purpose>
<core_principle>Same quality guarantees (source_restriction, atomic commits) but less ceremony. For changes small enough to plan and execute in one session. Quick fixes that break things are slow fixes.</core_principle>

<process>
<step name="INIT" priority="first">
Parse arguments, detect feature context, create workspace.

```
Flags:
  --discuss   -> surface gray areas first (optional)
  --research  -> check wiki knowledge before planning
  --full      -> plan-checker + post-exec verification

Remaining text -> DESCRIPTION
```

```bash
# Auto-discover devflow CLI (marketplace or local install)
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)

INIT=$(node "$DEVFLOW_BIN" init quick "$DESCRIPTION")
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
FEATURE=$(echo "$INIT" | jq -r '.feature.name')
TODAY=$(date +%Y%m%d)
SLUG=$(echo "$DESCRIPTION" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-' | head -c 40)
[ -z "$SLUG" ] && SLUG="quick-$(date +%s)"
QUICK_DIR="$WORKSPACE/.dev/quick/${TODAY}-${SLUG}"
mkdir -p "$QUICK_DIR"
```

Gate: `DESCRIPTION` must be non-empty. If missing: "What's the task? (e.g., 'fix typo in README', 'add log line to scheduler')"

Scope check: if task description implies >3 files or architectural changes, warn:
```
This looks too large for quick mode. Consider /devflow code for structured planning.
Proceed anyway? [y/N]
```
</step>

<step name="DISCUSS" condition="--discuss flag">
Lightweight gray-area check before planning.

1. Identify 2-3 ambiguities or decision points in the task
2. Present as quick choices (AskUserQuestion):
   ```
   Quick decisions needed:
   1. <ambiguity A> -- Option X or Y?
   2. <ambiguity B> -- Approach P or Q?
   ```
3. Save decisions to `$QUICK_DIR/context.md`:
   ```markdown
   # Quick Context: $DESCRIPTION
   Date: $TODAY

   ## Decisions
   - <decision 1>
   - <decision 2>
   ```
</step>

<step name="RESEARCH" condition="--research flag">
Wiki knowledge check before planning.

```bash
WIKI_DIR=$(echo "$INIT" | jq -r '.wiki_dir // empty')
```

If `$WIKI_DIR` exists:
1. Scan `$WIKI_DIR/index.md` for pages matching task keywords
2. Read matched pages (up to 3 -- quick mode, keep it lean)
3. Extract relevant constraints, patterns, or conventions
4. Pass as context to PLAN_AND_EXECUTE step

If no wiki or no matches: proceed without extra context.
</step>

<step name="PLAN_AND_EXECUTE">
Combined plan + execute in one pass. Maximum 3 tasks.

**Plan**: Generate tasks with:
- Max 3 tasks -- if more needed, abort and suggest `/devflow code`
- Each task: repo, worktree, files to modify, action description, verify command
- Constraints: `source_restriction` from `.dev.yaml` enforced
- No wave ordering needed (tasks are independent or sequential within 3)

**Execute** based on task count:
- **1 task**: execute inline (no subagent overhead)
- **2-3 tasks with no dependencies**: parallel subagents
- **2-3 tasks with dependencies**: sequential execution

For each task:
1. Read target files
2. Make the change
3. Run verify command (if specified):
   ```bash
   # Per-task verification
   bash -c "$VERIFY_CMD"
   ```
4. Atomic commit:
   ```bash
   git -C "$WORKSPACE" add <files>
   git -C "$WORKSPACE" commit -m "feat(quick): $TASK_DESCRIPTION"
   ```

**Source restriction enforcement**:
- Only modify files matching `source_restriction` patterns from `.dev.yaml`
- If a task requires files outside restriction: skip with warning

**Plan check** (if --full):
- Validate plan before execution
- Max 2 refinement iterations
- Check for missing edge cases, test coverage gaps
</step>

<step name="ERROR_HANDLING">
Handle task failures gracefully.

If any task failed:
```
Quick task results: $DONE/$TOTAL completed | $FAILED failed
```

Decision tree:
- **Partial success** (some tasks passed):
  ```
  $DONE/$TOTAL tasks completed. Failed tasks:
    - Task N: <error summary>

  Options:
    1. Review completed changes
    2. Retry failed tasks
    3. Enter debug mode: /devflow debug quick-$SLUG
  ```

- **All tasks failed**:
  ```
  All quick tasks failed. This may need a more structured approach.
  Options:
    1. /devflow code $FEATURE --spec  (full pipeline)
    2. /devflow debug quick-$SLUG     (investigate failures)
    3. Show error details
  ```

- **Verify command failed** (task executed but verification failed):
  ```
  Task completed but verification failed:
    Verify command: $VERIFY_CMD
    Exit code: $EXIT
    Output: <last 10 lines>

  The change may be incorrect. Revert? [Y/n]
  ```
  If yes: `git -C "$WORKSPACE" revert --no-edit HEAD`
</step>

<step name="SAVE">
Save summary and update state.

Write `$QUICK_DIR/summary.md`:
```markdown
# Quick: $DESCRIPTION
Date: $TODAY
Status: $DONE/$TOTAL completed

## Tasks
- [x] Task 1: <description> (commit: <hash>)
- [x] Task 2: <description> (commit: <hash>)
- [ ] Task 3: <description> (FAILED: <reason>)

## Files Changed
- repo/path/to/file.py
- repo/path/to/other.py
```

Update STATE.md quick tasks (if STATE.md exists).

Checkpoint:
```bash
node "$DEVFLOW_BIN" checkpoint \
  --action "quick" \
  --summary "Quick: $DESCRIPTION ($DONE/$TOTAL tasks)"
```

Output:
```
Quick: $DESCRIPTION
  Tasks: $DONE/$TOTAL completed
  Commits: <list of commit hashes>
  Files: <list of changed files>
  Summary: $QUICK_DIR/summary.md
```
</step>
</process>

<anti_rationalization>

## Anti-Rationalization Table

| Temptation | Reality Check |
|---|---|
| "It's just a quick fix" | Quick fixes that break things are slow fixes. Test after every change. |
| "I don't need a plan for 3 tasks" | Even 1 task needs clarity on WHAT, WHERE, and HOW to verify. |
| "I'll skip the verify command" | Unverified changes are guesses. Always verify, even for typo fixes. |
| "This needs just one more task" | Max 3. If you need more, use /devflow code for structured planning. |
| "Source restriction doesn't apply here" | It always applies. No exceptions. Ask the user to update .dev.yaml if needed. |
| "I'll commit everything together" | Atomic commits per task. One change, one commit, one revert target. |

## Red Flags

- Task count >3 (too large for quick mode)
- Task modifies files outside source_restriction
- No verify command for any task
- Multiple changes in a single commit
- Task description is vague ("fix stuff", "update things")
- Quick mode used for architectural changes

## Verification Checklist

- [ ] Task count <=3
- [ ] Each task has clear description and verify command
- [ ] Source restriction respected
- [ ] Atomic commit per task
- [ ] Summary saved to $QUICK_DIR/summary.md
- [ ] STATE.md updated (if exists)
- [ ] Failed tasks handled (retried, reverted, or escalated)

</anti_rationalization>
