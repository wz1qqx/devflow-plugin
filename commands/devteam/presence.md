---
name: devteam:presence
description: Session presence — soft-lock hints for concurrent track work
argument-hint: "<list|touch|clear> [--root <path>] [--set <track>] [--session-id <id>] [--purpose <text>] [--run <id>] [--ttl-seconds <n>] [--text] [--yes]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---
<objective>
Record and inspect lightweight active-session presence under `.devteam/presence`
without blocking work.
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
Run `node "$DEVTEAM_BIN" presence $ARGUMENTS`.

Subcommands:
- `touch`: write or refresh `.devteam/presence/<session-id>.json` for the
  selected track. Use `--set <track>`, optional `--run <id>`, optional
  `--purpose <text>`, and optional `--session-id <id>`.
  If `--session-id` is omitted, devteam derives a stable id from
  `DEVTEAM_SESSION_ID`, `CODEX_THREAD_ID`, `CODEX_SESSION_ID`,
  `CLAUDE_SESSION_ID`, or the terminal session before falling back to the
  parent process id. This keeps repeated console opens in the same conversation
  from creating duplicate soft-lock entries.
- `list`: show active presence entries grouped by track. Pass `--all` to include
  expired entries, `--ttl-seconds <n>` to override the default 45 minute TTL,
  and `--text` for compact output.
- `clear`: dry-run by default. Remove selected entries only with `--yes`; combine
  with `--expired`, `--set <track>`, or `--session-id <id>`.

Presence is a soft-lock hint only. It never blocks sync, record, build, publish,
or deploy. Use it to notice that another Codex session is already working on the
same track.
</process>
