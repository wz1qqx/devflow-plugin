---
name: devteam:session
description: Run session — start, snapshot, status, or record workspace validation runs
argument-hint: "<start|snapshot|status|record|list|lint|archive-plan|archive|supersede-plan|supersede-stale|close|supersede|reopen> [--root <path>] [--set <workspace-set>] [--run <id>] [--limit <n>] [--text] [--all] [--yes] [--kind <kind>] [--status <status>] [--summary <text>] [--pytest-log <path>] [--remote-pytest-log <path>]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---
<objective>
Create, inspect, and update an auditable `.devteam/runs/<id>/` directory for the local-to-remote validation loop.
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
INIT=$(node "$DEVTEAM_BIN" init session)
```

If `$INIT` contains `"feature": null` and `"available_features"`, prompt the user to select a feature with AskUserQuestion, then re-run: `INIT=$(node "$DEVTEAM_BIN" init session --feature $SELECTED)`

**Step 2**: Execute:
Run `node \"$DEVTEAM_BIN\" session start $ARGUMENTS` unless the user explicitly asks for `snapshot`, `status`, `record`, `list`, `lint`, `archive-plan`, `archive`, `supersede-plan`, `supersede-stale`, `close`, `supersede`, or `reopen`.

Display `run_id`, `path`, `readme_path`, `workspace_set`, profiles, and readiness status. Use `--no-build --no-deploy` for source/venv validation sessions before a concrete image or pre-production target has been chosen.

For `session status`, display the one-screen run summary:
- current `phase`
- latest evidence for `env-doctor`, `env-refresh`, `sync`, `test`, `image-build`, `deploy`, and `deploy-verify`
- workspace totals and concise worktree state
- sync/image/deploy/deploy-verify/publish gates
- publish-after-validation push plan when relevant
- concrete `next_actions`

If `--run` is omitted, `session status` reads the latest open run whose session metadata still matches current `.devteam/config.yaml`, skipping malformed, deleted-track, closed, and superseded history. Pass `--set <workspace-set>` to choose the latest readable run for one track. It prints JSON by default for scripting; pass `--text` for the compact dashboard view used by top-level `status`.

For `session list`, display recent run history:
- `run_id`, `workspace_set`, `created_at`, and current `phase`
- compact passed/failed/missing evidence summary
- image/deploy target when configured
- first concrete `next_action`

Use `--set <workspace-set>` to filter one track and `--limit <n>` to cap output. By default it shows active/open history; pass `--all` to include closed and superseded runs. It prints JSON by default; pass `--text` for a compact terminal view. The command is read-only and treats unreadable historical run directories as `unreadable` entries instead of stopping the whole list.

For `session lint`, report run-history hygiene issues without mutating anything:
- malformed `session.json`
- runs referencing deleted workspace sets or removed env/sync/build/deploy profiles
- stale worktree-head evidence recorded against older local HEADs

Use `--set <workspace-set>` to focus one track. In that mode, `latest_run_id` is also scoped to the selected track. By default closed and superseded runs do not produce stale-head warnings; pass `--all` when auditing full history. It prints JSON by default; pass `--text` for a compact terminal view.

For `session archive-plan`, list invalid run directories that can be moved out of active history without mutating anything. It only selects error-level metadata problems such as malformed `session.json`, deleted workspace sets, or removed profiles; stale evidence warnings remain in normal history.

For `session archive`, default to the same dry-run plan. Only move candidates to `.devteam/runs-archive/<run-id>/` when `--yes` is passed. Pass `--text` for the compact terminal view.

For `session supersede-plan`, preview stale historical runs that can safely be
marked superseded because the same track has a newer open run. The latest open
stale run for each track is blocked from automatic supersede because it is still
the active signal for that track.

For `session supersede-stale`, default to the same dry-run plan. Only update
`session.json` lifecycle metadata when `--yes` is passed:
```bash
node "$DEVTEAM_BIN" session supersede-stale --root <workspace> \
  --set <workspace-set> --yes
```

For `session close`, mark a run as closed without moving or deleting evidence:
```bash
node "$DEVTEAM_BIN" session close --root <workspace> --run <run-id> \
  --reason "superseded by a newer validation run"
```

For `session supersede`, mark an older run as replaced by a newer run:
```bash
node "$DEVTEAM_BIN" session supersede --root <workspace> --run <old-run-id> \
  --by <new-run-id> --reason "current HEAD has fresh validation"
```

Closed and superseded runs are kept in `.devteam/runs/` for auditability, but
default `session status`, `session list`, and `session lint` ignore them as
active history. Use `session reopen --run <run-id>` to make a run active again,
or `--all` on list/lint when inspecting full history.

For `session record`, append a completed step to the run:
```bash
node "$DEVTEAM_BIN" session record --root <workspace> --run <run-id> \
  --kind env-doctor --status passed --summary "remote venv doctor passed" \
  --command "devteam env doctor ..." --log "/remote/log/path.log"
```

Record writes both `events.jsonl` and the run `README.md`. Known kinds update the README result bullets: `sync`, `env-doctor`, `env-refresh`, `test`, `image-build`, `deploy`, and `deploy-verify`.

`session record` refuses to append evidence to closed or superseded runs by
default. Start a fresh run, reopen the old run, or use `--allow-closed` only
when intentionally recording historical evidence.

Specialized record commands may patch run profiles when a concrete optional
stage is recorded. For example, `image record --profile <build-profile>` sets
`profiles.build`, and `deploy record --profile <deploy-profile>` sets
`profiles.deploy`, so later `session status` treats those stages as part of the
run.

When the current session has an explicit track selection (`--set` or
`DEVTEAM_TRACK` / `DEVTEAM_WORKSPACE_SET`), `session record` refuses to write
evidence to a run from a different track. Pass the matching `--set`, switch the
session track, or use `--allow-cross-track` only when intentionally recording
cross-track evidence.

For head-sensitive evidence (`sync`, `test`, `publish`, `image-build`,
`deploy`, and `deploy-verify`), `session record` also checks the run's original
worktree HEAD snapshot against current local worktree HEADs. If they differ, it
refuses to write evidence by default. Start a new run for the current HEAD, or
use `--allow-stale-head` only when intentionally recording evidence for an older
snapshot. `env-doctor` and `env-refresh` are not head-guarded because they
describe environment state.

For pytest logs, omit `--kind`, `--status`, and `--summary` if the log contains the normal pytest terminal summary:
```bash
node "$DEVTEAM_BIN" session record --root <workspace> --run <run-id> \
  --pytest-log <local-log-path> --command "python -m pytest ..."
```

The command infers `kind=test`, sets status to `passed` or `failed`, and writes the parsed pytest summary into the run.

For logs that only exist on the remote validation server, use the session env profile or pass `--profile` explicitly:
```bash
node "$DEVTEAM_BIN" session record --root <workspace> --run <run-id> \
  --remote-pytest-log /remote/path/pytest.log --profile <env-profile> \
  --command "python -m pytest ..."
```
</process>
