---
name: devteam:sync
description: Sync planning — local worktrees to remote development environment
argument-hint: "<plan|apply|status> [--root <path>] [--set <workspace-set>] [--profile <env-profile>] [--patch-mode <branch-patch|dirty-only>] [--dirty-only] [--branch-patch] [--include-assets] [--yes] [--run <id>]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<objective>
Generate an explicit rsync plan for local-to-remote development testing.
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
INIT=$(node "$DEVTEAM_BIN" init sync)
```

If `$INIT` contains `"feature": null` and `"available_features"`, prompt the user to select a feature with AskUserQuestion, then re-run: `INIT=$(node "$DEVTEAM_BIN" init sync --feature $SELECTED)`

**Step 2**: Execute:
Run `node \"$DEVTEAM_BIN\" sync plan $ARGUMENTS` unless another subcommand is provided. Display syncable/missing totals, patch mode, patch file counts, and generated commands. `sync apply` is dry-run by default; only pass --yes when the user explicitly asks to execute rsync.

For relative patch sync strategies, `branch-patch` syncs `base_ref..HEAD` plus current dirty/staged/untracked files. This remains the default for `sync plan/apply`, and is useful when rebuilding a remote source mirror from a clean checkout. `dirty-only` syncs only current working tree, staged, and untracked files; use it for daily incremental validation when the remote mirror already has the branch baseline.

When `sync apply --yes --run <id>` is used, the command automatically appends a `sync` event to `.devteam/runs/<id>/events.jsonl` and updates the run README.

If `--set` or `DEVTEAM_TRACK` selects a track, the recorded sync evidence must
target a run from that same track. Use `--allow-cross-track` only for an
intentional exception.

Recorded sync evidence is head-guarded. If the run was created for an older
worktree HEAD, start a fresh run or pass `--allow-stale-head` only for an
intentional stale-head record.
</process>
