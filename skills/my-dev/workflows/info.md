# Workflow: info

<purpose>Project information: status overview or diff across repos. Replaces status.md and diff.md.</purpose>
<core_principle>Single glance at project state. Quick visibility into what's changed.</core_principle>

<process>
<step name="INIT" priority="first">
Load project state and parse subcommand.

```bash
INIT=$(node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init status)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
SUBCOMMAND="$1"   # "diff [repo]" or empty (status)
```
</step>

<step name="STATUS" condition="no subcommand or 'status'">
Display project overview.

For each repo in `$INIT.repos`:
```bash
WORKTREE=$(echo "$INIT" | jq -r ".repos.$repo.dev_worktree")
BASE_REF=$(echo "$INIT" | jq -r ".repos.$repo.base_ref")
```

```
Feature: <name> (<phase>)
Tag: <current_tag>

Repos:
  <repo>: <dev_worktree> (<base_ref> + N commits) [uncommitted: Y/N]

Cluster: <name> (<namespace>)
Hooks: N active (M learned)
Invariants: <key: value>
Knowledge: M/N features covered

Code Pipeline:
  Specs: <features with specs>
  Plans: <features with plans + progress>
  Reviews: <features with verdicts>
```

**Shared worktree detection**: Scan ALL features in `.dev.yaml`, build a map of `dev_worktree → [feature1, feature2, ...]`.
If any worktree is referenced by multiple features, display:

```
Shared Worktrees:
  <dev_worktree> ← <feature1>, <feature2>    # 代码改动互相影响
```

If `shared_with` field exists in scope, use it for display. Otherwise detect automatically by comparing worktree paths across features.
</step>

<step name="DIFF" condition="subcommand == 'diff'">
Show changes across dev_worktrees vs base_ref.

If specific repo given: detailed diff for that repo.
```bash
TARGET_REPO="$2"
WORKTREE=$(echo "$INIT" | jq -r ".repos.$TARGET_REPO.dev_worktree")
BASE_REF=$(echo "$INIT" | jq -r ".repos.$TARGET_REPO.base_ref")
git -C "$WORKSPACE/$WORKTREE" diff "$BASE_REF"
```

If no repo: summary table for all.
```bash
REPOS=$(echo "$INIT" | jq -r '.repos | keys[]')
for repo in $REPOS; do
  WORKTREE=$(echo "$INIT" | jq -r ".repos.$repo.dev_worktree")
  BASE_REF=$(echo "$INIT" | jq -r ".repos.$repo.base_ref")
  STAT=$(git -C "$WORKSPACE/$WORKTREE" diff --stat "$BASE_REF" 2>/dev/null)
done
```

```
Changes: <feature>

Repo       Files  Insertions  Deletions
dynamo     5      +120        -30
vllm       3      +45         -10

Detailed: /devflow info diff <repo>
```
</step>
</process>
