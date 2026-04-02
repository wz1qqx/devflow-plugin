# Workflow: init (Workspace Setup — v2)

<purpose>One-time workspace initialization: collect repos + infrastructure config, create baseline worktrees, generate v2 .dev.yaml.</purpose>
<core_principle>Workspace-level setup is done once. Features are added later via init-feature. Every repo gets baseline worktrees; dev worktrees are created per-feature.</core_principle>

<process>
<step name="COLLECT_WORKSPACE" priority="first">
Gather workspace-level configuration. Ask questions one at a time.

```bash
WORKSPACE=$(pwd)
```

1. **Workspace path**: "Workspace root? (default: current directory: $WORKSPACE)"
2. **Vault path**: "Obsidian vault path? (default: ~/Documents/Obsidian Vault)"
3. **Devlog group**: "Devlog group name? (e.g., dynamo — used for vault subdirectory)"
</step>

<step name="COLLECT_REPOS">
Collect repo definitions that will be shared across all features.

1. "Which repos are in this workspace? (space-separated names, e.g., dynamo vllm pegaflow)"
2. For each repo:
   - "Upstream URL for <repo>? (e.g., https://github.com/org/repo.git)"
   - Verify the repo directory exists at `$WORKSPACE/<repo>/`:
     ```bash
     if [ ! -d "$WORKSPACE/$repo/.git" ]; then
       echo "Warning: $WORKSPACE/$repo/ is not a git repo."
       echo "Clone it first, or provide correct path."
     fi
     ```
</step>

<step name="COLLECT_INFRA">
Optional infrastructure configuration.

1. **Build server** (optional): "Build server SSH? (e.g., user@host, or skip)"
   - If provided: "Remote work_dir?", "Docker registry URL?"
2. **Clusters** (optional): "Cluster name? (e.g., paigpu-a, or skip)"
   - If provided:
     - "SSH command for <cluster>?"
     - "K8s namespace? (default: default)"
     - "Safety level? (normal/prod, default: normal)"
   - "Add another cluster? (y/n)"
</step>

<step name="CREATE_BASELINES">
For each repo, ask for baseline refs and create detached worktrees.

```bash
for repo in $REPOS; do
  echo "=== $repo ==="
  echo "Baseline refs for $repo? (space-separated tags/commits/branches, e.g., v1.0.1 main)"
  # For each ref:
  for BASE_REF in $REFS; do
    # Verify ref exists
    if ! git -C "$WORKSPACE/$repo" rev-parse "$BASE_REF" >/dev/null 2>&1; then
      echo "Ref '$BASE_REF' not found. Fetch first?"
      echo "  git -C $WORKSPACE/$repo fetch --tags origin"
    fi

    # Determine worktree directory name
    BASE_WORKTREE="${repo}-${BASE_REF}"
    if [ -d "$WORKSPACE/$BASE_WORKTREE" ]; then
      echo "Baseline worktree already exists: $BASE_WORKTREE (binding existing)"
    else
      echo "Creating baseline: $BASE_WORKTREE"
      git -C "$WORKSPACE/$repo" worktree add --detach "../$BASE_WORKTREE" "$BASE_REF"
    fi
  done
done
```
</step>

<step name="GENERATE_CONFIG">
Write `.dev.yaml` with schema_version: 2.

Structure:
```yaml
schema_version: 2

workspace: <WORKSPACE>
vault: <VAULT>

devlog:
  group: <DEVLOG_GROUP>
  checkpoint: "{vault}/{group}/devlog/{feature}-checkpoint.md"
  investigation: "{vault}/{group}/devlog/{topic}-investigation.md"

build_server:    # only if provided
  ssh: <SSH>
  work_dir: <WORK_DIR>
  registry: <REGISTRY>

clusters:        # only if provided
  <name>:
    ssh: <SSH>
    namespace: <NAMESPACE>
    safety: <SAFETY>

repos:
  <repo>:
    upstream: <URL>
    baselines:
      <ref>: <worktree_dir>

defaults:
  active_feature: null
  active_cluster: <first_cluster_or_null>

features: {}

observability:
  grafana:
    url: ""
    dashboards_dir: ""
```

Omit `build_server` if not provided. Omit `clusters` if none.
</step>

<step name="INIT_DIRECTORIES">
Create supporting directory structure.

```bash
mkdir -p "$WORKSPACE/.dev/features"
mkdir -p "$WORKSPACE/hooks"
mkdir -p "$WORKSPACE/bench-results"

# Obsidian directories (only if vault configured)
if [ -n "$VAULT" ] && [ "$VAULT" != "null" ]; then
  KNOWLEDGE_DIR="$VAULT/$DEVLOG_GROUP/knowledge"
  EXPERIENCE_DIR="$VAULT/$DEVLOG_GROUP/experience"
  mkdir -p "$KNOWLEDGE_DIR"
  mkdir -p "$EXPERIENCE_DIR"
fi

# Add .dev/ to .gitignore if not already present
GITIGNORE="$WORKSPACE/.gitignore"
if [ -f "$GITIGNORE" ]; then
  grep -q "^\.dev/" "$GITIGNORE" || echo -e "\n# devflow working state\n.dev/" >> "$GITIGNORE"
else
  echo -e "# devflow working state\n.dev/" > "$GITIGNORE"
fi
```
</step>

<step name="INIT_STATE">
Create `.dev/STATE.md` from template.

Use the state template with:
- `project` → workspace directory name
- `phase` → init
- `current_feature` → null
- `last_activity` → current timestamp
</step>

<step name="OUTPUT_SUMMARY">
Display initialization summary.

```
Workspace initialized: $WORKSPACE

Repos ($REPO_COUNT):
  <repo>: baselines [<ref1>, <ref2>]

Infrastructure:
  Build server: <ssh or "none">
  Clusters: <list or "none">

Config: .dev.yaml (schema_version: 2)
State:  .dev/STATE.md
Hooks:  hooks/

No features yet. Create your first feature:
  /devflow:init feature <name>
```
</step>
</process>
