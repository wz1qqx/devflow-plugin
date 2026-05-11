---
name: devteam:remote-loop
description: Remote validation loop — start, sync, doctor, refresh, record tests, and status for the active track
argument-hint: "<plan|start|doctor|refresh|sync|record-test|status> [--root <path>] [--run <id>] [--yes] [--branch-patch] [--remote-pytest-log <path>] [--text]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---
<objective>
Run the active track's lightweight local-to-remote source/venv validation loop without choosing image or deployment recipes.
</objective>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover CLI tool:
```bash
DEVTEAM_BIN="${HOME}/.claude/plugins/marketplaces/devteam/lib/devteam.cjs"
[ -f "$DEVTEAM_BIN" ] || DEVTEAM_BIN=$(ls ~/.claude/plugins/cache/devteam/devteam/*/lib/devteam.cjs 2>/dev/null | head -1)
[ -n "$DEVTEAM_BIN" ] || { echo "ERROR: devteam.cjs not found" >&2; exit 1; }
```

**Step 2**: Execute:
Run `node \"$DEVTEAM_BIN\" remote-loop $ARGUMENTS`.

Subcommands:
- `plan`: print the concrete command sequence for the active track; pass
  `--text` for the compact terminal view. If the
  latest open run is stale because worktree HEAD changed, it keeps `start` and
  `status` visible but uses `<fresh-run-id>` for evidence-writing commands.
- `start`: create `.devteam/runs/<id>/` for active track remote validation.
  Build/deploy are disabled by default. Pass `--text` to print the new run id
  plus the concrete doctor/sync/record-test follow-up commands.
- `doctor`: run `env doctor --remote` for the active env profile and record `env-doctor` evidence to the run.
- `refresh`: show the editable venv refresh command. It only executes and records evidence with `--yes`.
- `sync`: show the dirty-only sync plan by default. It only applies and records evidence with `--yes`; pass `--branch-patch` when rebuilding the remote mirror from the full branch patch.
- `record-test`: record local or remote pytest log evidence using `--pytest-log` or `--remote-pytest-log`.
- `status`: show compact status for the latest run of the active track; pass `--json` for structured output.

If `--run` is omitted, mutating/recording subcommands use the most recent open
run whose `session.json` matches the active track. Closed and superseded runs
are ignored by default. This command does not choose test commands; test
execution remains manual and per-change.

If that latest open run is stale for the current worktree HEAD, mutating or
recording subcommands that omit `--run` refuse to continue before running remote
side effects. Start a fresh run first, then pass the new `--run <id>`.

Recording subcommands pass the active track through to `session record`, so they
refuse to append evidence to a run from another track. Use
`--allow-cross-track` only for an intentional exception.

`record-test` is also head-guarded. If the run was created for an older worktree
HEAD, start a fresh run for the current HEAD or pass `--allow-stale-head` only
when the stale-head recording is intentional.
</process>
