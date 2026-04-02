# Workflow: clean

<purpose>Scan and clean up orphan worktrees, old images, and stale pods. Dry-run by default.</purpose>
<core_principle>Never delete without confirmation. Dry-run first, then confirm each category. Preserve anything referenced by active features.</core_principle>

<process>
<step name="INIT" priority="first">
Load configuration and parse flags.

```bash
# Auto-discover devflow CLI (marketplace or local install)
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)

INIT=$(node "$DEVFLOW_BIN" init clean)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
DRY_RUN=true  # Default
if [[ "$*" != *"--dry-run"* ]] && [[ "$*" == *"--execute"* ]]; then
  DRY_RUN=false
fi
```
</step>

<step name="SCAN_WORKTREES">
Find orphan worktrees not referenced by any project.

```bash
# List all worktree directories in workspace
ALL_WORKTREES=$(find "$WORKSPACE" -maxdepth 1 -type d -name "*-*" | sort)

# Collect all referenced worktrees from all projects
REFERENCED=$(echo "$INIT" | jq -r '.all_features[].scope[].dev_worktree, .all_features[].scope[].base_worktree' | sort -u)

# Orphans = all minus referenced
ORPHAN_WORKTREES=()
for wt in $ALL_WORKTREES; do
  NAME=$(basename "$wt")
  if ! echo "$REFERENCED" | grep -q "^${NAME}$"; then
    ORPHAN_WORKTREES+=("$NAME")
  fi
done
```
</step>

<step name="SCAN_IMAGES">
Find old images not in any project's build_history.

```bash
BUILD_SERVER=$(echo "$INIT" | jq -r '.build_server.ssh // empty')
REGISTRY=$(echo "$INIT" | jq -r '.build_server.registry // empty')

if [ -n "$BUILD_SERVER" ]; then
  # List remote images
  REMOTE_IMAGES=$(ssh "$BUILD_SERVER" "docker images --format '{{.Repository}}:{{.Tag}}'" | grep "$REGISTRY" || true)

  # Collect all referenced tags
  REFERENCED_TAGS=$(echo "$INIT" | jq -r '.all_features[].build_history[].tag, .all_features[].current_tag' | sort -u)

  # Stale = images not in referenced tags
  STALE_IMAGES=()
  for img in $REMOTE_IMAGES; do
    TAG=$(echo "$img" | cut -d: -f2)
    if ! echo "$REFERENCED_TAGS" | grep -q "^${TAG}$"; then
      STALE_IMAGES+=("$img")
    fi
  done
fi
```
</step>

<step name="SCAN_PODS">
Find stale pods (Error, CrashLoopBackOff, Completed, Terminating).

```bash
CLUSTER_NAME=$(echo "$INIT" | jq -r '.cluster.name')
SSH=$(echo "$INIT" | jq -r '.cluster.ssh')
NAMESPACE=$(echo "$INIT" | jq -r '.cluster.namespace')

if [ -n "$SSH" ]; then
  STALE_PODS=$($SSH kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null | \
    grep -E 'Error|CrashLoopBackOff|Completed|Terminating' || true)
fi
```
</step>

<step name="REPORT_AND_EXECUTE">
Show scan results and optionally execute cleanup.

```
Cleanup Scan Results:

Orphan Worktrees (${#ORPHAN_WORKTREES[@]}):
  <worktree_name> (last modified: <date>)
  ...

Stale Images (${#STALE_IMAGES[@]}):
  <image:tag> (built: <date>)
  ...

Stale Pods (N):
  <pod_name> (<status>)
  ...
```

If `DRY_RUN`:
```
Dry run complete. To execute: /devflow clean --execute
```

If not dry run, confirm each category:
```
Clean orphan worktrees? (yes/skip)
```
If yes:
```bash
for wt in "${ORPHAN_WORKTREES[@]}"; do
  git worktree remove "$WORKSPACE/$wt" 2>/dev/null || rm -rf "$WORKSPACE/$wt"
done
```

```
Clean stale images? (yes/skip)
```
If yes:
```bash
for img in "${STALE_IMAGES[@]}"; do
  ssh "$BUILD_SERVER" "docker rmi $img"
done
```

```
Clean stale pods? (yes/skip)
```
If yes:
```bash
echo "$STALE_PODS" | awk '{print $1}' | while read pod; do
  $SSH kubectl delete pod "$pod" -n "$NAMESPACE" --force --grace-period=0
done
```

Output: "Cleanup complete. Removed: N worktrees, M images, K pods."
</step>
</process>
