# Workflow: resume

<purpose>Restore session state from HANDOFF.json, STATE.md, and .dev.yaml. Provide zero-loss context recovery with decisions, blockers, and precise next action.</purpose>
<core_principle>Zero context loss across sessions. Load everything needed to continue where the user left off. HANDOFF.json gives precise position; STATE.md gives accumulated knowledge.</core_principle>

<references>
@~/.claude/my-dev/references/memory-system.md
</references>

<process>
<step name="INIT" priority="first">
Load project state from configuration.

```bash
INIT=$(node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init resume)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
FEATURE=$(echo "$INIT" | jq -r '.feature.name')
PHASE=$(echo "$INIT" | jq -r '.feature.phase')
CURRENT_TAG=$(echo "$INIT" | jq -r '.feature.current_tag')
```

Gate: `.dev.yaml` must exist. If not, suggest: "No project found. Run `/devflow init`."
</step>

<step name="RESTORE_HANDOFF">
Check for HANDOFF.json and restore precise session position.

```bash
HANDOFF_PATH="$WORKSPACE/.dev/features/$FEATURE/HANDOFF.json"
```

If HANDOFF.json exists:
- Parse and extract: feature, feature_stage, task_progress, next_action, context_notes
- Display restoration summary:
  ```
  Restoring from HANDOFF.json (paused: <timestamp>)
  Feature: <feature> (stage: <stage>)
  Progress: <current>/<total> tasks
  Next action: <next_action>
  Context: <context_notes>
  ```
- Delete HANDOFF.json after successful load (only if feature matches current session):
  ```bash
  rm "$WORKSPACE/.dev/features/$FEATURE/HANDOFF.json"
  ```

If no HANDOFF.json: proceed with STATE.md and config-based resume.
</step>

<step name="LOAD_STATE_MD">
Load STATE.md for accumulated decisions and blockers.

```bash
STATE_PATH="$WORKSPACE/.dev/STATE.md"
```

If STATE.md exists, display:
```
Decisions (recent):
  D-01: <decision> (<date>, <feature>)
  D-02: <decision> (<date>, <feature>)

Active Blockers:
  B-01: <blocker> [<type>] - workaround: <workaround>
```

If no STATE.md: note "No STATE.md found. Will be created on next workflow action."
</step>

<step name="LOAD_FEATURE_CONTEXT">
If an active feature is detected (from HANDOFF, STATE.md, or plans/), load feature context.

```bash
FEATURE_DIR="$WORKSPACE/.dev/features/$FEATURE"
```

Load if available:
- `features/<feature>/context.md` -- discussion decisions and user preferences
- Obsidian `knowledge/<feature>.md` -- domain knowledge (auto-managed by learn workflow)
- `features/<feature>/plan.md` -- current plan with task statuses

Display feature artifact status:
```
Feature: <feature>
  Spec: [exists/missing]
  Context: [exists/missing]
  Research: [exists/missing]
  Plan: [exists/missing] (<done>/<total> tasks)
  Review: [exists/missing] (verdict: <verdict>)
```
</step>

<step name="SHOW_STATUS">
Display current project status.

```
Project: $PROJECT
Phase: $PHASE
Tag: $CURRENT_TAG

Repos:
  <repo>: <dev_worktree> (<base_ref> + N commits) [uncommitted: Y/N]

Cluster: $CLUSTER ($NAMESPACE)
Knowledge: M/N features covered
```
</step>

<step name="LOAD_KNOWLEDGE">
Auto-load relevant knowledge notes for the current context.

```bash
VAULT=$(echo "$INIT" | jq -r '.vault')
DEVLOG_GROUP=$(echo "$INIT" | jq -r '.devlog.group')
KNOWLEDGE_DIR="$VAULT/$DEVLOG_GROUP/knowledge"
```

Read matching notes based on active feature.
Also load recent experience notes matching the feature topic.
Run freshness checks on loaded notes.
</step>

<step name="SUGGEST_NEXT">
Suggest next action based on current phase and restored state.

**If HANDOFF was restored**: use `next_action` from HANDOFF as primary suggestion.

**Otherwise**, suggest based on phase:

| Phase | Suggestion |
|-------|-----------|
| `init` | "Project initialized. Start development: `/devflow dev`" |
| `dev` | "Continue development. Build when ready: `/devflow build`" |
| `build` | "Build complete ($CURRENT_TAG). Deploy: `/devflow deploy`" |
| `deploy` | "Deployed. Verify: `/devflow verify --smoke`" |
| `verify` | "Verified. Observe: `/devflow observe` or start next feature" |
| `debug` | "Debug session active. Resume investigation or close." |

Also check for in-progress code workflows:
- If `.dev/features/<feature>/plan.md` has pending tasks: "Resume execution: `/devflow code <feature> --exec`"
- If `.dev/features/<feature>/review.md` has FAIL verdict: "Fix review issues: `/devflow code <feature> --exec`"

Check active blockers and warn if any are unresolved.
</step>
</process>
