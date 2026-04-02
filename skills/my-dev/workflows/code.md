# Workflow: code

<purpose>Router for the structured coding pipeline. Dispatches to the appropriate sub-workflow based on the flag provided.</purpose>
<core_principle>Single entry point for all coding operations. Auto-detect stage when no flag given.</core_principle>

<process>
<step name="INIT" priority="first">
Load project configuration and parse arguments.

```bash
INIT=$(node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init code)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
FEATURE=$(echo "$ARGUMENTS" | awk '{print $1}')
FLAG=$(echo "$ARGUMENTS" | grep -oE '\-\-(spec|plan|exec|review|status)' | head -1)
```

Gate: `FEATURE` must be non-empty. If missing, check `defaults.active_feature` from config. If still empty, prompt: "Which feature? Provide a short kebab-case name."
</step>

<step name="DISPATCH">
Route to the appropriate sub-workflow based on the flag.

| Flag | Action |
|------|--------|
| `--spec` | Delegate to @~/.claude/my-dev/workflows/code-spec.md |
| `--plan` | Delegate to @~/.claude/my-dev/workflows/code-plan.md |
| `--exec` | Delegate to @~/.claude/my-dev/workflows/code-exec.md |
| `--review` | Delegate to @~/.claude/my-dev/workflows/code-review.md |
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
When no flag is provided, detect the current stage from existing artifacts and resume.

Priority order (latest stage first):
1. If `review.md` exists with FAIL verdict -> re-run `--exec` to fix issues
2. If `plan.md` exists with pending tasks -> resume `--exec`
3. If `spec.md` exists but no `plan.md` -> run `--plan`
4. If nothing exists -> run `--spec`

Report detection:
```
Auto-detected stage: <stage> (based on <artifact>)
Proceeding with: /devflow code $FEATURE --<stage>
```

Then delegate to the detected sub-workflow.
</step>
</process>
