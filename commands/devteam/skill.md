---
name: devteam:skill
description: Skill management — discover, lint, and install devteam Codex skills
argument-hint: "<list|status|lint|install> [name] [--root <path>] [--target <path>] [--all] [--yes] [--text]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---
<objective>
Manage repo/workspace Codex skill folders separately from knowledge docs.
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
Run `node "$DEVTEAM_BIN" skill $ARGUMENTS`. list/status shows repo skills plus workspace .devteam/skills folders, their install target, and whether installed copies are missing/current/drift/invalid. lint validates SKILL.md frontmatter, folder/name alignment, and duplicate sources. install is dry-run by default; only use --yes when the user explicitly asks to copy skill folders into the target skills directory. Default target is ~/.agents/skills; use --target to override.
</process>
