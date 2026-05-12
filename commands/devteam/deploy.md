---
name: devteam:deploy
description: Deploy planning and evidence recording for k8s pre-production validation
argument-hint: "<plan|record|verify-record> [--root <path>] [--set <workspace-set>] [--profile <deploy-profile>] [--run <id>] [--namespace <namespace>] [--image <ref>]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<objective>
Show the k8s deployment profile and migrated deploy commands for pre-production validation, then record deployment and post-deploy verification evidence separately.
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
Run `node "$DEVTEAM_BIN" deploy plan $ARGUMENTS`. Display namespace, env, guide, gateway recipe, migrated deploy commands, run_gate, verify_gate, and next_action. Do not mutate the cluster unless the user explicitly asks. Use deploy record after deploying the image, then deploy verify-record after health checks, smoke traffic, or benchmark validation pass.
</process>
