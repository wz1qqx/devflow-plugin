---
name: devteam:session
description: Run session — start, snapshot, status, or record workspace validation runs
argument-hint: "<start|snapshot|status|handoff|record|list|lint|archive-plan|archive|supersede-plan|supersede-stale|close|supersede|reopen> [--root <path>] [--set <workspace-set>] [--run <id>] [--limit <n>] [--text] [--all] [--yes] [--kind <kind>] [--status <status>] [--summary <text>] [--pytest-log <path>] [--remote-pytest-log <path>]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---
<objective>
Create, inspect, and update an auditable .devteam/runs/<id>/ directory for the local-to-remote validation loop.
</objective>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover the devteam CLI:
```bash
DEVTEAM_BIN="${HOME}/.claude/plugins/marketplaces/devteam/lib/devteam.cjs"
[ -f "$DEVTEAM_BIN" ] || DEVTEAM_BIN=$(ls ~/.claude/plugins/cache/devteam/devteam/*/lib/devteam.cjs 2>/dev/null | head -1)
[ -n "$DEVTEAM_BIN" ] || { echo "ERROR: devteam.cjs not found" >&2; exit 1; }
```

If no `--root` is provided, use the current workspace or nearest parent containing `.devteam/config.yaml`. Do not select a global active track; ask the user to choose a track or pass `--set <track>` when the command needs one.

**Step 2**: Execute:
Run `node "$DEVTEAM_BIN" session start $ARGUMENTS` unless the user explicitly asks for snapshot, status, handoff, record, list, lint, archive-plan, archive, supersede-plan, supersede-stale, close, supersede, or reopen. For start, display run_id, path, readme_path, workspace_set, profiles, and readiness status. Use --no-build --no-deploy for source/venv validation sessions before a concrete image or pre-production target has been chosen. For status, display phase, latest evidence, workspace totals, sync/image/deploy/deploy-verify/publish gates, publish-after-validation plan, and next_actions; if --run is omitted it reads the latest open readable run, skips historical runs that no longer match current config, and honors --set to pick the latest run for one track. For handoff, print an agent-focused continuation packet with workspace, track, run, lifecycle, stale-head status, profiles, worktrees, verified evidence, do-not rules, and next actions; use it before context switches or when handing work to another session. session list is read-only and displays recent open runs, phase, evidence summary, first next_action, and supports --set, --limit, --all, and --text. session lint is read-only and reports malformed run metadata, runs referencing deleted workspace sets/profiles, and stale worktree-head evidence; by default it ignores closed/superseded runs, with --all it audits full history, and with --set its latest_run_id is scoped to that track. session supersede-plan previews stale old runs that have newer open runs on the same track, while blocking each track's latest stale run; session supersede-stale is dry-run by default and marks only supersedeable stale runs when --yes is passed. session close/supersede/reopen update session.json lifecycle metadata without moving evidence; superseded and closed runs stay auditable but are ignored by default active history. session archive-plan is read-only and lists only invalid metadata runs that can be moved to .devteam/runs-archive/. session archive is dry-run by default and moves those invalid run directories only with --yes. session status/handoff/list/lint/archive-plan/archive print JSON by default; pass --text for compact text. For record, append completed step evidence to events.jsonl and README.md with --run, --kind, --status, --summary, and optional --command/--log/--artifact; it refuses closed/superseded runs unless --allow-closed is passed. For pytest, use --pytest-log or --remote-pytest-log to infer kind=test, passed/failed status, and summary from the pytest terminal line.
</process>
