---
name: devteam:ws
description: Workspace inventory — local repo/worktree status
argument-hint: "<status|materialize|publish-plan|publish> [--root <path>] [--set <workspace-set>] [--text] [--full] [--limit <n>] [--apply] [--run <id>] [--yes]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---
<objective>
Inspect local worktrees from .devteam/config.yaml without loading the legacy feature pipeline.
</objective>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover CLI tool and load config:
```bash
DEVTEAM_BIN="${HOME}/.claude/plugins/marketplaces/devteam/lib/devteam.cjs"
[ -f "$DEVTEAM_BIN" ] || DEVTEAM_BIN=$(ls ~/.claude/plugins/cache/devteam/devteam/*/lib/devteam.cjs 2>/dev/null | head -1)
[ -n "$DEVTEAM_BIN" ] || { echo "ERROR: devteam.cjs not found" >&2; exit 1; }
INIT=$(node "$DEVTEAM_BIN" init ws)
```

If `$INIT` contains `"feature": null` and `"available_features"`, prompt the user to select a feature with AskUserQuestion, then re-run: `INIT=$(node "$DEVTEAM_BIN" init ws --feature $SELECTED)`

**Step 2**: Execute:
Run `node \"$DEVTEAM_BIN\" ws $ARGUMENTS`. For status, display one row per worktree: id, repo, path, branch, dirty, dirty_file_count, dirty_summary, dirty_files, commits_ahead, exists, source_exists. Pass `--text` for the compact terminal view, `--full` to show the full captured dirty file list, or `--limit <n>` to cap dirty file lines. For materialize, display planned clone commands; only use --apply when the user explicitly asks to create local clones. For publish-plan, display worktrees marked `publish.after_validation`, their branch/dirty/remote-ref state, run_gate if --run is passed, blocked_by reasons, and generated git push commands. For publish, dry-run by default, require a ready run gate by default, execute only with --yes, and record publish evidence to the run.

If `--set` or `DEVTEAM_TRACK` selects a track, recorded publish evidence must
target a run from that same track. Use `--allow-cross-track` only for an
intentional exception.

Recorded publish evidence is head-guarded. If the run was created for an older
worktree HEAD, start a fresh run or pass `--allow-stale-head` only for an
intentional stale-head record.
</process>
