# Workflow: code

<purpose>Router for the structured coding pipeline. Dispatches to the appropriate sub-workflow based on the flag provided. Auto-detects task complexity to select pipeline depth.</purpose>
<core_principle>Single entry point for all coding operations. Match pipeline depth to task complexity: quick tasks skip ceremony, large tasks get full scrutiny.</core_principle>

<process>
<step name="INIT" priority="first">
Load project configuration and parse arguments.

```bash
# Auto-discover devflow CLI (marketplace or local install)
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)
DEVFLOW_BIN="${DEVFLOW_BIN:-$HOME/.claude/my-dev/bin/my-dev-tools.cjs}"

INIT=$(node "$DEVFLOW_BIN" init code)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
FEATURE=$(echo "$ARGUMENTS" | awk '{print $1}')
FLAG=$(echo "$ARGUMENTS" | grep -oE '\-\-(spec|plan|exec|review|status|quick)' | head -1)
DESCRIPTION=$(echo "$ARGUMENTS" | sed 's/^[^ ]* *//' | sed 's/--[^ ]* *//')
```

Gate: `FEATURE` must be non-empty. If missing, check `defaults.active_feature` from config. If still empty, prompt: "Which feature? Provide a short kebab-case name."
</step>

<step name="SIZE_DETECT" condition="no flag provided and DESCRIPTION is non-empty">
Classify task complexity to determine pipeline depth.

```bash
SIZE_RESULT=$(node "$DEVFLOW_BIN" classify "$DESCRIPTION")
SIZE=$(echo "$SIZE_RESULT" | jq -r '.size')
PIPELINE=$(echo "$SIZE_RESULT" | jq -r '.pipeline | join(" → ")')
```

Display:
```
Task complexity: $SIZE
Pipeline: $PIPELINE
```

| Size | Pipeline | When |
|------|----------|------|
| `quick` | exec → commit | Typos, config changes, version bumps |
| `small` | plan → exec → review | 1-3 files, < 100 lines |
| `medium` | spec → plan → exec → review | Cross-file changes (default) |
| `large` | discuss → spec → plan → exec → review | Cross-repo, architecture changes |

- If `quick`: delegate to @./quick.md with the description
- If `small`: skip spec, go directly to `--plan`
- If `medium`: proceed to AUTO_DETECT (standard flow)
- If `large`: check if `context.md` exists (discuss output); if not, suggest `--discuss` first

Ask: "继续？[Y / 调整复杂度]"
</step>

<step name="DISPATCH">
Route to the appropriate sub-workflow based on the flag.

| Flag | Action |
|------|--------|
| `--spec` | Delegate to @./code-spec.md |
| `--plan` | Delegate to @./code-plan.md |
| `--exec` | Delegate to @./code-exec.md |
| `--review` | Delegate to @./code-review.md |
| `--status` | Show feature pipeline status (see STATUS step below) |
| No flag | Auto-detect from existing artifacts (see AUTO_DETECT step below) |
</step>

<step name="STATUS">
Read feature directory and show pipeline status inline (no sub-workflow needed).

```bash
FEATURE_DIR="$WORKSPACE/.dev/features/$FEATURE"
```

Check existence of each artifact and display:
```
Feature: $FEATURE
  Spec:    [exists/missing]  .dev/features/$FEATURE/spec.md
  Context: [exists/missing]  .dev/features/$FEATURE/context.md
  Knowledge: [FRESH/STALE/MISS]  Obsidian knowledge/$FEATURE.md
  Plan:    [exists/missing]  .dev/features/$FEATURE/plan.md  (N/M tasks done)
  Review:  [exists/missing]  .dev/features/$FEATURE/review.md (verdict: PASS/FAIL)
  Summary: [exists/missing]  .dev/features/$FEATURE/summary.md
```
</step>

<step name="AUTO_DETECT">
When no flag is provided and no description given, detect the current stage from existing artifacts and resume.

Priority order (latest stage first):
1. If `review.md` exists with FAIL verdict -> re-run `--exec` to fix issues
2. If `plan.md` exists with pending tasks -> resume `--exec`
3. If `context.md` exists (discuss done) but no `plan.md` -> run `--plan`
4. If `spec.md` exists but no `plan.md` -> run `--plan`
5. If nothing exists -> run `--spec`

Report detection:
```
Auto-detected stage: <stage> (based on <artifact>)
Proceeding with: /devflow code $FEATURE --<stage>
```

Then delegate to the detected sub-workflow.
</step>
</process>
