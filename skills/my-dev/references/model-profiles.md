# Model Profiles

Agent model assignments for /devflow workflows. Follows GSD's tiered approach.

## Profiles

| Profile | Planning | Execution | Verification | Research |
|---------|----------|-----------|-------------|----------|
| `quality` | opus | opus | sonnet | sonnet |
| `balanced` (default) | opus | sonnet | sonnet | haiku |
| `budget` | sonnet | sonnet | haiku | haiku |

## Per-Agent Resolution

| Agent | quality | balanced | budget |
|-------|---------|----------|--------|
| my-dev-researcher | sonnet | haiku | haiku |
| my-dev-planner | opus | opus | sonnet |
| my-dev-plan-checker | sonnet | sonnet | haiku |
| my-dev-executor | opus | sonnet | sonnet |
| my-dev-reviewer | opus | sonnet | sonnet |
| my-dev-verifier | sonnet | sonnet | haiku |
| my-dev-debugger | sonnet | sonnet | sonnet |

## Usage

```bash
node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" resolve-model my-dev-planner
# Returns: opus (if balanced profile)
```

Profile is stored in `.dev.yaml` under `defaults.model_profile` (default: `balanced`).
