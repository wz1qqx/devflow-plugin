# Workflow: pause

<purpose>Capture precise session state for zero-loss resume. Write HANDOFF.json, update STATE.md, and prompt for knowledge sink to Obsidian.</purpose>
<core_principle>Nothing valuable should be lost between sessions. Working memory is ephemeral -- anything worth keeping must be explicitly saved to STATE.md or sunk to Obsidian.</core_principle>

<references>
@~/.claude/my-dev/references/memory-system.md
</references>

<process>
<step name="INIT" priority="first">
Load current project state and configuration.

```bash
INIT=$(node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init resume)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
FEATURE=$(echo "$INIT" | jq -r '.feature.name')
```

Gate: `.dev.yaml` must exist. If not, abort: "No project found. Nothing to pause."
</step>

<step name="GATHER_STATE">
Collect current session state from all sources.

1. **Read STATE.md** if exists:
   ```bash
   STATE_PATH="$WORKSPACE/.dev/STATE.md"
   ```
   Parse frontmatter: project, phase, current_feature, feature_stage, plan_progress

2. **Detect active feature**: from STATE.md frontmatter or from recent `.dev/features/` activity

3. **Scan uncommitted files** across all dev worktrees:
   ```bash
   # For each repo in project
   git -C "$WORKSPACE/$DEV_WORKTREE" status --porcelain
   ```

4. **Parse plan progress** if a feature is active and has a plan:
   ```bash
   PLAN_PATH="$WORKSPACE/.dev/features/$FEATURE/plan.md"
   # Count done/total tasks
   ```

5. **Collect decisions made this session**: scan recent STATE.md additions or conversation context

6. **Collect active blockers**: from STATE.md Blockers table where status=active
</step>

<step name="WRITE_HANDOFF">
Write HANDOFF.json with precise session state.

```bash
mkdir -p "$WORKSPACE/.dev/features/$FEATURE"
```

Write `.dev/features/$FEATURE/HANDOFF.json`:
```json
{
  "version": "1.0",
  "timestamp": "<ISO-8601 now>",
  "project": "$FEATURE",
  "feature": "$FEATURE or null",
  "feature_stage": "$FEATURE_STAGE or null",
  "task_progress": { "current": $DONE, "total": $TOTAL },
  "completed_tasks": ["<list of done task titles>"],
  "remaining_tasks": ["<list of pending task titles>"],
  "blockers": [<active blockers from STATE.md>],
  "decisions_this_session": ["<decisions added during this session>"],
  "uncommitted_files": ["<paths with uncommitted changes>"],
  "next_action": "<specific first action for next session>",
  "context_notes": "<any mental state or context worth preserving>"
}
```
</step>

<step name="UPDATE_STATE_MD">
Update STATE.md with current position.

If STATE.md does not exist, create from template:
```bash
TEMPLATE="$HOME/.claude/my-dev/templates/state.md"
```

Update frontmatter fields:
- `last_activity`: current ISO-8601 timestamp
- `current_feature`: active feature or null
- `feature_stage`: current stage or null
- `plan_progress`: current progress string

Update Position section:
```markdown
## Position
Currently working on: <current activity summary>
Next step: <what to do next session>
```

Do NOT modify Decisions or Blockers sections (append-only, handled by dedicated functions).
</step>

<step name="KNOWLEDGE_SINK_PROMPT">
Prompt user to sink valuable knowledge to Obsidian.

```
Session paused successfully.

HANDOFF.json written: .dev/features/$FEATURE/HANDOFF.json
STATE.md updated: .dev/STATE.md
```

Check if there are sinkable artifacts:
1. **Debug resolutions this session**: if any debug workflow ran and found root cause:
   ```
   Debug resolution found: <topic>
   Save experience to Obsidian? [Y/n]
   ```
   If yes: create experience note at `<vault>/<group>/experience/<topic>-patterns.md`

2. **Reusable patterns from review**: if code review found reusable patterns:
   ```
   Reusable pattern found: <pattern>
   Save to Obsidian knowledge? [Y/n]
   ```
   If yes: create knowledge note at `<vault>/<group>/knowledge/<pattern>.md`

3. **General knowledge**: always ask:
   ```
   Anything else worth saving to Obsidian? (type topic or "no")
   ```
</step>

<step name="CHECKPOINT">
Record the pause in checkpoint log.

```bash
node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" checkpoint \
  --action "pause" \
  --summary "Session paused. Feature: $FEATURE, Stage: $FEATURE_STAGE, Progress: $PLAN_PROGRESS"
```

Final output:
```
Session paused.
Feature: <feature> (stage: <stage>, progress: <progress>)
Next session: /devflow resume
```
</step>
</process>
