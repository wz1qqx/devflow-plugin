---
name: devteam:track
description: Track management — list, inspect, or switch active workspace tracks
argument-hint: "<list|status|bind|use> [track] [--root <path>] [--set <track>] [--text] [--no-runtime] [--active-only] [--dry-run]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---
<objective>
Inspect tracks, bind one track to the current terminal/session, or update the workspace default profile bundle.
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
```

**Step 2**: Execute:
Run `node \"$DEVTEAM_BIN\" track $ARGUMENTS`.

Track selection order is `--set`, `DEVTEAM_TRACK` / `DEVTEAM_WORKSPACE_SET`,
then `.devteam/config.yaml defaults.workspace_set`.

Track names accept canonical names plus configured aliases. Matching is
normalized for spaces, underscores, and hyphens, so aliases like `v0201`,
`tokenspeed`, or `ts mla` can be used with `--set`, `DEVTEAM_TRACK`,
`track bind`, and `track use`. If an alias is ambiguous, stop and ask the user
to choose the canonical track.

For `track list`, display each workspace set with aliases, inferred env, sync,
build, deploy flow, validation profile, repo count, selected marker, workspace
dirty/missing totals, latest run phase, and active presence soft-lock hints.
Pass `--text` for the compact track dashboard and `--no-runtime` to skip
workspace/run/presence inspection.

Tracks may declare `status: active`, `status: parked`, or `status: archived`.
Use `track list --active-only` to show the daily working set: active tracks plus
the selected/default track, tracks with dirty/missing worktrees, active presence,
or an unfinished latest run. Omit `--active-only` to inspect all tracks.

For `track status`, display selected track source, workspace default, inferred
profile bundle, active worktree totals, dirty worktrees, latest run, and next
action.

For `track bind <track>`, print an `export DEVTEAM_TRACK=...` command for this
terminal/session without modifying `.devteam/config.yaml`.

For `track use <track>`, update only the `defaults` block in `.devteam/config.yaml`:
- `workspace_set`
- `env`
- `sync`
- `build`
- `deploy`
- `deploy_flow`
- `validation`

Use `track use` mainly to change the workspace default. Prefer `track bind` or
explicit `--set` when multiple sessions may be active. Use `--dry-run` when
previewing the defaults change. This command does not touch worktrees, remote
servers, images, or clusters.
</process>
