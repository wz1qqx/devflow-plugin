# Workflow: init-feature (Feature Setup — v2)

<purpose>Initialize a new feature within an existing v2 workspace: select repos, create dev worktrees, scan knowledge, update .dev.yaml.</purpose>
<core_principle>Features are lightweight and scoped. Each feature selects a subset of workspace repos, picks baseline refs, and gets its own dev worktrees.</core_principle>

<process>
<step name="INIT" priority="first">
Validate input and load workspace configuration.

```bash
FEATURE_NAME="$1"   # e.g., "decode-l2-cache"
WORKSPACE=$(pwd)
CONFIG="$WORKSPACE/.dev.yaml"
```

Validate:
- `FEATURE_NAME` must be kebab-case, not already in `.dev.yaml`. If no name provided, ask.
- `.dev.yaml` must exist with `schema_version: 2`
- Load `repos` and `features` sections
</step>

<step name="SELECT_SCOPE">
Interactive: select repos, baselines, and description.

**Repos**: Present available repos as multi-select (from `repos` section). User picks subset or all.

**Baselines**: For each selected repo, present available baselines from `repos.<name>.baselines`.
If user wants a new baseline: ask for ref, create baseline worktree, add to config.

**Description**: Ask for brief feature description.
</step>

<step name="CREATE_DEV_WORKTREES">
For each selected repo, choose worktree strategy via AskUserQuestion:

**Option A: 创建新 worktree** (default for independent features)
```bash
DEV_WORKTREE="${repo}-${FEATURE_NAME}"
git -C "$WORKSPACE/$repo" worktree add -b "$FEATURE_NAME" "../$DEV_WORKTREE" "$BASE_REF"
```

**Option B: 绑定已有 worktree** (for features that share code base)
Scan all existing features in `.dev.yaml`, collect their dev_worktrees for this repo.
Present as choices:
```
dynamo dev worktree 策略:
  a) 创建新 worktree: dynamo-<FEATURE_NAME> (独立开发)
  b) 共享 dynamo-support-kimi-pd (来自 dynamo-with-pegaflow)
  c) 共享 dynamo-xxx (来自 other-feature)
```

If user picks shared:
- Record the existing worktree name in scope (no git operation needed)
- Tag the scope entry with `shared_with: <source_feature>` for visibility:
  ```yaml
  scope:
    dynamo:
      base_ref: v1.0.1
      dev_worktree: dynamo-support-kimi-pd
      shared_with: dynamo-with-pegaflow
  ```

If worktree path already exists but not from another feature: offer bind / recreate / abort.
</step>

<step name="SCAN_KNOWLEDGE">
Check Obsidian vault for matching knowledge notes by feature name keywords.

Report:
- Covered keywords → note paths
- Uncovered keywords → suggest `/devflow:learn`
</step>

<step name="SAVE">
Persist feature configuration and state.

1. Append to `.dev.yaml` features section:
   ```yaml
   <FEATURE_NAME>:
     description: "<description>"
     created: "<today>"
     scope:
       <repo>:
         base_ref: <baseline>
         dev_worktree: <worktree_dir>
     phase: spec
   ```
2. Set `defaults.active_feature` to this feature
3. Create `mkdir -p .dev/features/$FEATURE_NAME`
4. State update (@references/shared-patterns.md#state-update): stage=`spec`
</step>

<step name="OUTPUT_SUMMARY">
Display feature initialization summary.

```
Feature: <FEATURE_NAME> initialized

Scope:
  <repo>: <base_ref> → <dev_worktree>/ (dev)

Knowledge:
  OK  <covered> → <note_path>
  --  <uncovered> (suggest /devflow:learn)

Next: /devflow:code <FEATURE_NAME> --spec
  or: /devflow:learn <topic> (if knowledge gaps)
```
</step>
</process>
