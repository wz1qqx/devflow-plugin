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
**Step 1**: Discover CLI tool and load config:
```bash
DEVTEAM_BIN="${HOME}/.claude/plugins/marketplaces/devteam/lib/devteam.cjs"
[ -f "$DEVTEAM_BIN" ] || DEVTEAM_BIN=$(ls ~/.claude/plugins/cache/devteam/devteam/*/lib/devteam.cjs 2>/dev/null | head -1)
[ -n "$DEVTEAM_BIN" ] || { echo "ERROR: devteam.cjs not found" >&2; exit 1; }
INIT=$(node "$DEVTEAM_BIN" init deploy)
```

If `$INIT` contains `"feature": null` and `"available_features"`, prompt the user to select a feature with AskUserQuestion, then re-run: `INIT=$(node "$DEVTEAM_BIN" init deploy --feature $SELECTED)`

**Step 2**: Execute:
Run `node \"$DEVTEAM_BIN\" deploy plan $ARGUMENTS`. Display namespace, env, guide, gateway recipe, migrated deploy commands, run_gate, verify_gate, and next_action. Do not mutate the cluster unless the user explicitly asks.

Use `--run <id>` to show whether the run has passing `image-build` evidence before deployment and passing `deploy` evidence before post-deploy verification.

After the image is deployed to the pre-production target, record deployment evidence:
```bash
node "$DEVTEAM_BIN" deploy record --root <workspace> --run <run-id> \
  --status passed --namespace <namespace> --image <registry/name:tag> \
  --command "kubectl ..." --log "/path/to/deploy.log"
```

After health checks, smoke traffic, or benchmark validation pass, record verification evidence:
```bash
node "$DEVTEAM_BIN" deploy verify-record --root <workspace> --run <run-id> \
  --status passed --namespace <namespace> --image <registry/name:tag> \
  --summary "preprod checks passed" --log "/path/to/verify.log"
```

If `deploy record` or `deploy verify-record` includes
`--profile <deploy-profile>`, devteam also binds that deploy profile to the run
by updating `.devteam/runs/<id>/session.json` `profiles.deploy`. This lets a run
that started as `--no-deploy` become a pre-production validation run after an
optional track-level deploy is actually recorded.

If `--set` or `DEVTEAM_TRACK` selects a track, `deploy record` and
`deploy verify-record` refuse to append evidence to a run from a different
track unless `--allow-cross-track` is passed.
Deploy evidence is also head-guarded; use `--allow-stale-head` only when
recording deployment evidence for an older run snapshot is intentional.
</process>
