# Skill: ship (SHIP)

<purpose>
Strategy-driven build, deploy, and rollback unified into one flow. Reads ship.strategy from .dev.yaml (docker | k8s | ci-cd) and executes the appropriate pipeline. Rollback is an internal step triggered by --rollback flag or post-deploy failure.
</purpose>

<core_principle>
Every deploy needs a kill switch. ALL kubectl commands MUST include `-n <namespace>` — this is a hard invariant, never omitted. Production namespaces require the user to type the namespace name to confirm. Ship only when the pre-ship checklist passes and a rollback plan exists.
</core_principle>

<process>

<step name="INIT" priority="first">
Initialize workflow context, load build config, cluster config, and build history.

```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)

INIT=$(node "$DEVFLOW_BIN" init ship)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
FEATURE=$(echo "$INIT" | jq -r '.feature.name')
```

Extract configuration:
```bash
CURRENT_TAG=$(echo "$INIT" | jq -r '.feature.current_tag')
BASE_IMAGE=$(echo "$INIT" | jq -r '.feature.base_image')
REGISTRY=$(echo "$INIT" | jq -r '.build_server.registry')
BUILD_COMMANDS=$(echo "$INIT" | jq -r '.build.commands')
BUILD_ENV=$(echo "$INIT" | jq -r '.build.env')
REPOS=$(echo "$INIT" | jq -r '.repos | keys[]')
BUILD_HISTORY=$(echo "$INIT" | jq -r '.build_history')

CLUSTER_NAME=$(echo "$INIT" | jq -r '.cluster.name')
NAMESPACE=$(echo "$INIT" | jq -r '.cluster.namespace')
SSH=$(echo "$INIT" | jq -r '.cluster.ssh')
SAFETY=$(echo "$INIT" | jq -r '.cluster.safety')
DEPLOY_CONFIG=$(echo "$INIT" | jq -r '.deploy')

STRATEGY=$(echo "$INIT" | jq -r '.feature.ship_strategy // .defaults.ship_strategy // "docker"')
```

Gate: `build.commands` must be configured. If not, abort: "No build commands configured in .dev.yaml"

If `$ARGUMENTS` contains `--rollback`, jump directly to the ROLLBACK step.
</step>

<step name="PRE_SHIP_CHECKLIST">
Validate everything before building or deploying. Every item must pass.

**1. Code Validation:**
```bash
# Tests must pass
TEST_CMD=$(echo "$INIT" | jq -r '.build.test_command // empty')
if [ -n "$TEST_CMD" ]; then
  bash -c "$TEST_CMD"
fi
```
- Tests pass (exit 0)
- Lint clean (no warnings in scope files)
- No debug statements (`console.log`, `debugger`, `print(` in production paths)

**2. Invariant Checks:**
- `source_restriction` compliance: all changed files within registered dev_worktrees
- `build_compat_check`: changes backward-compatible with base_ref

**3. Pre-ship Hooks:**
Execute `.hooks.pre_build` and `.hooks.pre_deploy` from .dev.yaml.
Execute `.hooks.learned` rules where `trigger == "pre_build"` or `trigger == "pre_deploy"`.

Load experience anti-patterns:
```bash
VAULT=$(echo "$INIT" | jq -r '.vault')
DEVLOG_GROUP=$(echo "$INIT" | jq -r '.devlog.group')
EXPERIENCE_DIR="$VAULT/$DEVLOG_GROUP/experience"
```
Scan `$EXPERIENCE_DIR/` for files matching build/deploy topics.
Extract all **Anti-patterns** sections and display as warnings.

**4. Rollback Plan:**
```bash
PREV_TAG=$(echo "$BUILD_HISTORY" | jq -r '.[-1].tag // empty')
```
If `PREV_TAG` is empty and strategy is `k8s`: WARN "No previous known-good tag. First deploy — manual rollback only."
If `PREV_TAG` exists: record as rollback target.

Report:
```
Pre-ship Checklist:
  Tests: PASS
  Lint: PASS
  Debug statements: PASS (none found)
  Invariants: PASS
  Pre-ship hooks: PASS (N executed)
  Rollback target: $PREV_TAG (or "none — first deploy")
```

Gate: Any failure aborts. Fix issues before retrying.
</step>

<step name="STRATEGY_ROUTER">
Read `ship.strategy` from .dev.yaml feature config or defaults, then route to the appropriate sub-flow.

```bash
echo "Ship strategy: $STRATEGY"
```

| Strategy | Flow |
|----------|------|
| `docker` | Build image only (DOCKER_BUILD) |
| `k8s` | Build image + deploy to cluster (DOCKER_BUILD -> K8S_DEPLOY) |
| `ci-cd` | Trigger external pipeline (CI_CD_TRIGGER) |

Route to the matching sub-flow below.
</step>

<step name="DOCKER_BUILD">
Build container image with incremental tag chain.

**Tag suggestion:**
```bash
DATE_PREFIX=$(date +%m%d)
FIRST_DEV_WORKTREE=$(echo "$INIT" | jq -r '[.repos[] | select(.dev_worktree)] | .[0].dev_worktree')
KEYWORD=$(git -C "$FIRST_DEV_WORKTREE" log -1 --format=%s | head -c 20 | tr ' ' '-')
SUGGESTED_TAG="${DATE_PREFIX}-${KEYWORD}"
```

If user provided a tag argument, use that instead. Confirm with user:
```
Build Summary:
  Base image: $REGISTRY/$BASE_IMAGE:$CURRENT_TAG
  New tag: $SUGGESTED_TAG
  Strategy: $STRATEGY

  Repos included:
    <repo>: <dev_worktree> (<N files changed>)

Proceed? (yes / change tag / abort)
```

CRITICAL: `BASE_IMAGE` must use `current_tag` (incremental chain), NOT the official base image.
If `current_tag` is empty, this is the first build — use `base_image` from config.

**Execute build:**
```bash
export BASE_IMAGE="$REGISTRY/$BASE_IMAGE_NAME:$CURRENT_TAG"
export NEW_TAG="$CONFIRMED_TAG"

for repo in $REPOS; do
  WORKTREE=$(echo "$INIT" | jq -r ".repos.$repo.dev_worktree")
  BASE_REF=$(echo "$INIT" | jq -r ".repos.$repo.base_ref")
  export "${repo^^}_WORKTREE=$WORKTREE"
  export "${repo^^}_BASE_REF=$BASE_REF"
done

for key in $(echo "$BUILD_ENV" | jq -r 'keys[]? // empty'); do
  export "$key=$(echo "$BUILD_ENV" | jq -r ".$key")"
done

BUILD_CMD=$(echo "$BUILD_COMMANDS" | jq -r ".$VARIANT // .default")
bash -c "$BUILD_CMD"
```

Execute with `run_in_background=true` for long builds.

Gate: Build must exit 0. Non-zero exit aborts and shows logs.

**Push to registry** (if `--push` flag or strategy is `k8s`):
```bash
docker push "$REGISTRY/$BASE_IMAGE_NAME:$CONFIRMED_TAG"
```

**Update .dev.yaml:**
- Set `features.$FEATURE.current_tag` to `$CONFIRMED_TAG`
- Append to `features.$FEATURE.build_history`:
  ```yaml
  - tag: <CONFIRMED_TAG>
    date: <TODAY>
    changes: <summary>
    base: <CURRENT_TAG>
    cluster: <active_cluster>
  ```

If strategy is `docker` (build-only), skip to POST_SHIP.
If strategy is `k8s`, continue to K8S_DEPLOY.
</step>

<step name="K8S_DEPLOY">
Deploy built image to Kubernetes cluster. Entered after DOCKER_BUILD when strategy is `k8s`.

**GPU Environment Check** (skip if `cluster.hardware.gpu` is "none" or empty):
```bash
GPU_TYPE=$(echo "$INIT" | jq -r '.cluster.hardware.gpu // empty')
```
If `$GPU_TYPE` is non-empty and not "none":

1. GPU hardware status:
```bash
GPU_STATUS=$($SSH "nvidia-smi --query-gpu=index,name,memory.used,memory.total,temperature.gpu,utilization.gpu --format=csv,noheader,nounits 2>/dev/null")
```
If nvidia-smi fails: ABORT "CUDA driver not responding on target node."
- Temperature >85C: WARN (thermal throttling risk)
- Memory usage >90%: WARN (another workload may be running)

2. Free GPU count:
```bash
EXPECTED_TP=$(echo "$INIT" | jq -r '.cluster.hardware.expected_tp // 1')
FREE_GPUS=$(echo "$GPU_STATUS" | awk -F',' '{gsub(/ /,"",$3); if ($3+0 < 1000) print $1}' | wc -l | tr -d ' ')
```
If free GPUs < `expected_tp`: ABORT "Need $EXPECTED_TP free GPUs but only $FREE_GPUS available."

3. Stale process detection:
```bash
STALE=$($SSH "pgrep -af 'vllm serve|vllm.entrypoints' 2>/dev/null | grep -v pgrep || true")
```
If stale processes found: WARN and list PIDs. Offer cleanup before deploy.

4. Model weight path (if configured):
```bash
MODEL_PATH=$(echo "$DEPLOY_CONFIG" | jq -r '.model_path // empty')
if [ -n "$MODEL_PATH" ]; then
  $SSH "test -d '$MODEL_PATH' && echo 'exists' || echo 'missing'"
fi
```
If configured and missing: WARN "Model path $MODEL_PATH not found on target."

Report:
```
GPU Environment: $CLUSTER_NAME
  GPUs: $TOTAL total, $FREE_GPUS free | Max temp: ${MAX_TEMP}C
  Model cache: ${MODEL_PATH:-N/A}
  Status: READY / WARN / ABORT
```

**Namespace Safety:**
```bash
echo "Target namespace: $NAMESPACE"
echo "Target cluster: $CLUSTER_NAME"
```

If `safety == "prod"`:
```
[PRODUCTION CLUSTER]
You are deploying to a PRODUCTION cluster: $CLUSTER_NAME
Namespace: $NAMESPACE
Image: $CONFIRMED_TAG

Type the namespace name to confirm: _____
```
Require user to type the exact namespace name. Mismatch aborts.

If `safety == "normal"`:
```
Deploying $CONFIRMED_TAG to $CLUSTER_NAME/$NAMESPACE
Confirm? (yes/abort)
```

**Execute deploy:**
```bash
DEPLOY_STRATEGY=$(echo "$DEPLOY_CONFIG" | jq -r '.strategy // "apply"')
```

Strategy: delete-then-apply:
```bash
RESOURCE_KIND=$(echo "$DEPLOY_CONFIG" | jq -r '.resource_kind // "deployment"')
DGD_NAME=$(echo "$DEPLOY_CONFIG" | jq -r '.dgd_name')
$SSH kubectl delete "$RESOURCE_KIND" "$DGD_NAME" -n "$NAMESPACE" --ignore-not-found=true
$SSH kubectl wait --for=delete pod -l "app=$DGD_NAME" -n "$NAMESPACE" --timeout=120s 2>/dev/null || true

YAML_FILE=$(echo "$DEPLOY_CONFIG" | jq -r '.yaml_file')
$SSH kubectl apply -f "$YAML_FILE" -n "$NAMESPACE"
```

Strategy: apply (rolling update):
```bash
YAML_FILE=$(echo "$DEPLOY_CONFIG" | jq -r '.yaml_file')
$SSH kubectl apply -f "$YAML_FILE" -n "$NAMESPACE"
```

**Wait for pods ready:**
```bash
TIMEOUT=$(echo "$INIT" | jq -r '.tuning.deploy_timeout')
INTERVAL=$(echo "$INIT" | jq -r '.tuning.deploy_poll_interval')
ELAPSED=0

while [ $ELAPSED -lt $TIMEOUT ]; do
  PODS=$($SSH kubectl get pods -n "$NAMESPACE" -l "app=$DGD_NAME" -o json)
  READY=$(echo "$PODS" | jq '[.items[].status.containerStatuses[]?.ready] | all')
  TOTAL=$(echo "$PODS" | jq '.items | length')
  RUNNING=$(echo "$PODS" | jq '[.items[] | select(.status.phase=="Running")] | length')

  echo "Pods: $RUNNING/$TOTAL running"

  if [ "$READY" == "true" ] && [ "$TOTAL" -gt 0 ]; then
    echo "All pods ready!"
    break
  fi

  if [ $ELAPSED -ge $TIMEOUT ]; then
    echo "[ALERT] Pods stuck after ${TIMEOUT}s. Checking logs..."
    PROBLEM_POD=$($SSH kubectl get pods -n "$NAMESPACE" -l "app=$DGD_NAME" --no-headers | head -1 | awk '{print $1}')
    $SSH kubectl logs "$PROBLEM_POD" -n "$NAMESPACE" --tail=50
    break
  fi

  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done
```

**Health check** (if service_url configured):
```bash
SVC_URL=$(echo "$DEPLOY_CONFIG" | jq -r '.service_url // empty')
MODEL_NAME=$(echo "$DEPLOY_CONFIG" | jq -r '.model_name // empty')
if [ -n "$SVC_URL" ]; then
  HEALTH_TIMEOUT=600
  HEALTH_START=$(date +%s)
  while [ $(( $(date +%s) - HEALTH_START )) -lt $HEALTH_TIMEOUT ]; do
    HEALTH_CODE=$($SSH "curl -s -o /dev/null -w '%{http_code}' http://$SVC_URL/health 2>/dev/null" || echo "000")
    if [ "$HEALTH_CODE" = "200" ]; then
      HEALTH_TIME=$(( $(date +%s) - HEALTH_START ))
      echo "Health endpoint: OK (model loaded in ${HEALTH_TIME}s)"
      break
    fi
    sleep 10
  done
fi
```

**Post-deploy hooks:**
Execute `.hooks.post_deploy` from .dev.yaml:
- Label services with discovery labels
- Wait for all pods ready
- Post-deploy hooks are non-blocking: warn on failure but do not abort

Continue to POST_SHIP.
</step>

<step name="CI_CD_TRIGGER">
Trigger external CI/CD pipeline. Entered when strategy is `ci-cd`.

```bash
CI_CMD=$(echo "$DEPLOY_CONFIG" | jq -r '.ci_trigger_command // empty')
if [ -z "$CI_CMD" ]; then
  echo "No ci_trigger_command configured in .dev.yaml deploy config."
  exit 1
fi
```

**Trigger pipeline:**
```bash
echo "Triggering CI/CD pipeline..."
CI_RESULT=$(bash -c "$CI_CMD" 2>&1)
CI_EXIT=$?
```

If exit != 0: ABORT with pipeline output.

**Wait for pipeline** (if wait command configured):
```bash
CI_WAIT_CMD=$(echo "$DEPLOY_CONFIG" | jq -r '.ci_wait_command // empty')
if [ -n "$CI_WAIT_CMD" ]; then
  echo "Waiting for pipeline completion..."
  bash -c "$CI_WAIT_CMD"
fi
```

**Verify deployment health** (if health endpoint configured):
```bash
SVC_URL=$(echo "$DEPLOY_CONFIG" | jq -r '.service_url // empty')
if [ -n "$SVC_URL" ]; then
  HEALTH_CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://$SVC_URL/health" 2>/dev/null || echo "000")
  if [ "$HEALTH_CODE" = "200" ]; then
    echo "Deployment health: OK"
  else
    echo "[WARN] Health check returned $HEALTH_CODE"
  fi
fi
```

Continue to POST_SHIP.
</step>

<step name="POST_SHIP">
Post-ship health check, first-request validation, and state update.

**First-request validation** (if service_url and model_name configured):
```bash
SVC_URL=$(echo "$DEPLOY_CONFIG" | jq -r '.service_url // empty')
MODEL_NAME=$(echo "$DEPLOY_CONFIG" | jq -r '.model_name // empty')
if [ -n "$SVC_URL" ] && [ -n "$MODEL_NAME" ]; then
  FIRST_START=$(date +%s%3N)
  FIRST_REQ=$($SSH "curl -sf http://$SVC_URL/v1/completions \
    -H 'Content-Type: application/json' \
    -d '{\"model\": \"$MODEL_NAME\", \"prompt\": \"Hello\", \"max_tokens\": 5, \"temperature\": 0}' 2>&1" || true)
  FIRST_END=$(date +%s%3N)
  FIRST_LATENCY=$((FIRST_END - FIRST_START))
  if echo "$FIRST_REQ" | jq -e '.choices[0].text' > /dev/null 2>&1; then
    echo "First request: OK (${FIRST_LATENCY}ms)"
  else
    echo "[WARN] First request failed or returned unexpected response"
    echo "Response: $FIRST_REQ"
    echo "Consider: /devflow ship --rollback"
  fi
fi
```

**State update:**
Update `.dev.yaml`:
- Set `features.$FEATURE.phase` to `ship`
- Set `features.$FEATURE.current_tag` to `$CONFIRMED_TAG`
- Record ship timestamp

Checkpoint (@references/shared-patterns.md#checkpoint):
```bash
node "$DEVFLOW_BIN" checkpoint \
  --action "ship" \
  --summary "Shipped $CONFIRMED_TAG via $STRATEGY to $CLUSTER_NAME/$NAMESPACE"
```

Output:
```
Ship complete: $CONFIRMED_TAG
  Strategy: $STRATEGY
  Cluster: $CLUSTER_NAME/$NAMESPACE
  Pods: $RUNNING/$TOTAL ready
  Health: ${HEALTH_TIME:-N/A}s
  First request: ${FIRST_LATENCY:-N/A}ms
  Rollback target: $PREV_TAG

Next: /devflow verify --smoke
```

**Wiki stale check** (after successful ship):
If `$WIKI_DIR` is set, scan `$WIKI_DIR/index.md` for pages whose tags match the shipped repos/components. If any pages are STALE:
```
Wiki hint: N pages may be outdated after this ship:
  - <page>.md (repo_commits behind by M commits)
  Refresh: /devflow learn <topic>
```
This is informational only.
</step>

<step name="ROLLBACK">
Internal rollback step. Triggered by `--rollback` flag or post-deploy failure.

**Resolve target tag:**
```bash
TARGET_TAG="$1"  # Optional: specific tag to roll back to

if [ -z "$TARGET_TAG" ]; then
  PREV_TAG=$(echo "$BUILD_HISTORY" | jq -r '.[-2].tag // empty')
  if [ -z "$PREV_TAG" ]; then
    echo "No previous tag in build_history. Cannot rollback."
    exit 1
  fi
  TARGET_TAG="$PREV_TAG"
else
  EXISTS=$(echo "$BUILD_HISTORY" | jq -r ".[] | select(.tag == \"$TARGET_TAG\") | .tag")
  if [ -z "$EXISTS" ]; then
    echo "Tag '$TARGET_TAG' not found in build_history. Available tags:"
    echo "$BUILD_HISTORY" | jq -r '.[].tag'
    exit 1
  fi
fi
```

**Confirm with user:**
```
Rollback: $CURRENT_TAG -> $TARGET_TAG
Cluster: $CLUSTER_NAME/$NAMESPACE
Strategy: $DEPLOY_STRATEGY

Proceed? (yes/abort)
```

**Execute rollback:**
```bash
YAML_FILE=$(echo "$DEPLOY_CONFIG" | jq -r '.yaml_file')
# Update image tag in deploy YAML
sed -i '' "s|$CURRENT_TAG|$TARGET_TAG|g" "$YAML_FILE"

DEPLOY_STRATEGY=$(echo "$DEPLOY_CONFIG" | jq -r '.strategy // "apply"')
if [ "$DEPLOY_STRATEGY" == "delete-then-apply" ]; then
  DGD_NAME=$(echo "$DEPLOY_CONFIG" | jq -r '.dgd_name')
  RESOURCE_KIND=$(echo "$DEPLOY_CONFIG" | jq -r '.resource_kind // "deployment"')
  $SSH kubectl delete "$RESOURCE_KIND" "$DGD_NAME" -n "$NAMESPACE" --ignore-not-found=true
  $SSH kubectl wait --for=delete pod -l "app=$DGD_NAME" -n "$NAMESPACE" --timeout=120s 2>/dev/null || true
fi

$SSH kubectl apply -f "$YAML_FILE" -n "$NAMESPACE"
```

**Wait for pods ready:**
```bash
TIMEOUT=$(echo "$INIT" | jq -r '.tuning.deploy_timeout')
INTERVAL=$(echo "$INIT" | jq -r '.tuning.deploy_poll_interval')
ELAPSED=0

while [ $ELAPSED -lt $TIMEOUT ]; do
  PODS=$($SSH kubectl get pods -n "$NAMESPACE" -l "app=$DGD_NAME" -o json)
  READY=$(echo "$PODS" | jq '[.items[].status.containerStatuses[]?.ready] | all')
  TOTAL=$(echo "$PODS" | jq '.items | length')

  if [ "$READY" == "true" ] && [ "$TOTAL" -gt 0 ]; then
    echo "Rollback pods ready!"
    break
  fi

  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done
```

**Update state:**
- Set `features.$FEATURE.current_tag` to `$TARGET_TAG`
- Set `features.$FEATURE.phase` to `ship`

Checkpoint:
```bash
node "$DEVFLOW_BIN" checkpoint \
  --action "rollback" \
  --summary "Rollback: $CURRENT_TAG -> $TARGET_TAG on $CLUSTER_NAME/$NAMESPACE"
```

Output:
```
Rollback complete: $CURRENT_TAG -> $TARGET_TAG
Cluster: $CLUSTER_NAME/$NAMESPACE

Next: /devflow verify --smoke
```
</step>

<step name="KNOWLEDGE_SINK">
@references/shared-patterns.md#experience-sink

Detection criteria: build failure (even if retried), deploy timeout, rollback triggered, hook warnings, GPU issues, namespace safety override
Target file: `ship-lessons.md`
Context fields: `tag=$CONFIRMED_TAG, strategy=$STRATEGY, cluster=$CLUSTER_NAME, namespace=$NAMESPACE`
</step>

</process>

<anti_rationalization>

| Rationalization | Reality |
|---|---|
| "Works in staging" | Production has different data, traffic, and edge cases. Staging success is necessary but not sufficient. |
| "Rolling back is failure" | Rolling back is responsible engineering. Shipping broken code is the failure. |
| "No rollback plan needed" | Every deploy needs a kill switch. The rollback plan is decided BEFORE you ship, not during an incident. |
| "I'll add monitoring later" | Without monitoring, you learn about problems from user complaints. Ship observability with the feature. |
| "It's just a config change" | Config changes cause as many outages as code changes. Same checklist, same rigor. |

**Red Flags:**
- No rollback plan identified before shipping
- Shipping on Friday afternoon (high risk, low support availability)
- No post-deploy verification (health check, first request)
- Skipping namespace safety confirmation for production clusters
- kubectl commands missing `-n <namespace>` (hard invariant violation)
- Deploying without running the pre-ship checklist
- Ignoring GPU environment warnings before vLLM deploy

**Verification:**
- [ ] Pre-ship checklist passed (tests, lint, invariants, hooks)
- [ ] Image built and pushed (if applicable)
- [ ] Deployment healthy (pods ready, health endpoint OK)
- [ ] First-request validation passed (if applicable)
- [ ] Rollback plan ready (previous known-good tag identified)
- [ ] All kubectl commands include `-n <namespace>`
- [ ] State updated to phase=ship

</anti_rationalization>
</output>
