---
name: devteam:env
description: Environment profiles — list, doctor, or refresh remote/k8s profiles
argument-hint: "<list|doctor|refresh> [--root <path>] [--profile <name>] [--remote] [--yes] [--run <id>]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<objective>
Inspect lightweight remote_dev and k8s environment profiles, and refresh vLLM editable remote venvs when explicitly requested.
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
INIT=$(node "$DEVTEAM_BIN" init env)
```

If `$INIT` contains `"feature": null` and `"available_features"`, prompt the user to select a feature with AskUserQuestion, then re-run: `INIT=$(node "$DEVTEAM_BIN" init env --feature $SELECTED)`

**Step 2**: Execute:
Run `node \"$DEVTEAM_BIN\" env $ARGUMENTS`. For doctor, display local command checks and missing profile fields. `--remote` performs explicit read-only SSH checks; never run remote mutations from this command.

For `remote_dev` profiles, pay special attention to source-mirror and venv fields:
- `source_dir` should exist and report a clean/expected git status, HEAD, and `git describe`.
- `venv`, `python`, and `site_packages` should exist.
- vLLM-like profiles also run an editable import check and print Python version, prefix, package metadata version, and `vllm_file`.

For `env refresh`, display the generated remote command first when `--yes` is absent. Only execute refresh with explicit `--yes`. Refresh is intended for vLLM-like `remote_dev` profiles using `install_mode: editable-precompiled`; it refreshes package metadata after the source mirror HEAD changes.

When `env doctor --remote --run <id>` is used, the command automatically appends an `env-doctor` event to `.devteam/runs/<id>/events.jsonl` and updates the run README.

When `env refresh --yes --run <id>` is used, the command automatically appends an `env-refresh` event to `.devteam/runs/<id>/events.jsonl` and updates the run README.

If `--set` or `DEVTEAM_TRACK` selects a track, recorded env evidence must target
a run from that same track. Use `--allow-cross-track` only for an intentional
exception.
</process>
