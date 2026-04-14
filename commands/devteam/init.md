---
name: devteam:init
description: Initialize workspace or add a new feature
argument-hint: "<workspace|feature> [name]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<objective>
Bootstrap a new workspace (workspace.yaml, directories, baselines) or add a new feature with scope, worktrees, and initial config.
</objective>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover CLI tool and parse action from `$ARGUMENTS`:
```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devteam/devteam/*/lib/devteam.cjs 2>/dev/null | head -1)
ACTION=$(echo "$ARGUMENTS" | awk '{print $1}')   # "workspace" or "feature"
FEATURE_NAME=$(echo "$ARGUMENTS" | awk '{print $2}')  # optional for "feature" action
```

**Step 2 — ACTION = workspace**:

The CLI does not create workspace.yaml. You must write it. Use AskUserQuestion to collect the required fields, then write `workspace.yaml` using the schema defined in `skills/references/schema.md`.

Minimum required structure to collect:
```yaml
schema_version: 2
workspace: <absolute path>          # ask user
vault: <obsidian vault path>         # ask user (optional)
devlog:
  group: <project group name>        # ask user (e.g. "dynamo")
  checkpoint: "{vault}/{group}/devlog/{feature}-checkpoint.md"
  investigation: "{vault}/{group}/devlog/{topic}-investigation.md"
build_server:
  ssh: <ssh connection string>
  work_dir: <remote work dir>
  registry: <docker registry URL>
repos:
  <repo-name>:
    upstream: <git URL>
    baselines:
      <tag>: <local worktree dir>    # relative to workspace
clusters:
  <cluster-name>:
    ssh: <ssh string>
    namespace: <k8s namespace>
    safety: normal | prod
    hardware:
      gpu: <gpu model>
      min_driver: <min driver version>
      expected_tp: <int>
    network:
      socket_ifname: <ifname>
      ucx_tls: <tls mode>
defaults:
  active_cluster: <cluster-name>
  active_feature: null
  tuning:
    regression_threshold: 20
    max_optimization_loops: 3
    deploy_timeout: 300
    deploy_poll_interval: 15
```

After writing `workspace.yaml`, create the `.dev/` directory structure:
```bash
mkdir -p .dev/features
```

Confirm: `node "$DEVFLOW_BIN" init workspace` — verify JSON output has correct workspace path and repos.

**Step 2 — ACTION = feature**:

Read existing `workspace.yaml` to find available repos and their baselines. Use AskUserQuestion to collect:
1. Feature name (or use `$FEATURE_NAME` if provided)
2. Description
3. Which repos are in scope, and which `base_ref` (baseline tag) to use for each
4. Which cluster to use (from existing `clusters:` keys)

Write `.dev/features/<name>/config.yaml` — flat file, no `features:` nesting:
```yaml
description: <description>
created: <YYYY-MM-DD>
phase: dev
cluster: <cluster-name>
scope:
  <repo-name>:
    base_ref: <tag>
    base_worktree: <dir>    # from repos.<name>.baselines.<tag>
    dev_worktree: null      # will be created on first build
deploy:
  yaml_file: <path>
  dgd_name: <deployment name>
  service_url: <url>
  model_name: <model>
benchmark:
  mtb_cmd: "<full command with {frontend_svc_label} {arrival_rate} {total_sessions} placeholders>"
  mtb_dir: <working dir>
  frontend_svc_label: <svc url>
  standard:
    arrival_rate: <float>
    total_sessions: <int>
verify:
  smoke_cmd: <single request command>
  smoke_count: 5
  warmup_count: 3
  pod_selector: "app=<dgd_name>"
```

Register and set as active:
```bash
node "$DEVFLOW_BIN" features switch <name>    # sets active_feature AND adds to defaults.features list
```

Confirm: `node "$DEVFLOW_BIN" init feature <name>` — verify JSON output shows correct repos, cluster, deploy config.
</process>
