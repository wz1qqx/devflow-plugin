# Workflow: deploy

<purpose>Deploy container image to Kubernetes cluster with hook execution, namespace safety, and pod readiness verification.</purpose>
<core_principle>Namespace safety is non-negotiable. ALL kubectl commands MUST include -n <namespace>. Production clusters require explicit confirmation for every destructive operation.</core_principle>

<process>
<step name="INIT" priority="first">
Initialize workflow and load deploy configuration.

```bash
# Auto-discover devflow CLI (marketplace or local install)
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)

INIT=$(node "$DEVFLOW_BIN" init deploy)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
```

Extract deploy config:
```bash
CURRENT_TAG=$(echo "$INIT" | jq -r '.feature.current_tag')
CLUSTER_NAME=$(echo "$INIT" | jq -r '.cluster.name')
NAMESPACE=$(echo "$INIT" | jq -r '.cluster.namespace')
SSH=$(echo "$INIT" | jq -r '.cluster.ssh')
SAFETY=$(echo "$INIT" | jq -r '.cluster.safety')
DEPLOY_CONFIG=$(echo "$INIT" | jq -r '.deploy')
STRATEGY=$(echo "$DEPLOY_CONFIG" | jq -r '.strategy // "apply"')
```
</step>

<step name="SPECIFICITY_GATE">
Check if the deploy request is specific enough for direct execution.

```bash
SPEC_CHECK=$(node "$DEVFLOW_BIN" check-specificity "$ARGUMENTS")
SPECIFIC=$(echo "$SPEC_CHECK" | jq -r '.specific')
```

If NOT specific (missing cluster, tag, or feature context):
- Check: `CURRENT_TAG` must be non-empty. If null: "No image tag set. Run `/devflow:build` first?"
- Check: `CLUSTER_NAME` must be non-empty. If null: present cluster selection via AskUserQuestion
- Check: `NAMESPACE` must be non-empty. If null: abort with clear error

If `$ARGUMENTS` contains `--force`, skip this gate.
</step>

<step name="GPU_ENVIRONMENT_CHECK">
Remote GPU and environment pre-check before deploying vLLM workload.
Skip this step if `$ARGUMENTS` contains `--skip-gpu-check`, or if the cluster
has `hardware.gpu: none` in .dev.yaml.

```bash
GPU_TYPE=$(echo "$INIT" | jq -r '.cluster.hardware.gpu // empty')
```
If `$GPU_TYPE` is empty or "none", skip this step silently.

1. **GPU Hardware Status**:
```bash
GPU_STATUS=$($SSH "nvidia-smi --query-gpu=index,name,memory.used,memory.total,temperature.gpu,utilization.gpu --format=csv,noheader,nounits 2>/dev/null")
```
If nvidia-smi fails entirely, ABORT: "CUDA driver not responding on target node."
Parse each GPU line:
- If any GPU temperature >85C: WARN (thermal throttling risk)
- If any GPU memory usage >90%: WARN (another workload may be running)

2. **Free GPU Count**:
```bash
EXPECTED_TP=$(echo "$INIT" | jq -r '.cluster.hardware.expected_tp // 1')
FREE_GPUS=$(echo "$GPU_STATUS" | awk -F',' '{gsub(/ /,"",$3); if ($3+0 < 1000) print $1}' | wc -l | tr -d ' ')
```
If free GPUs < `expected_tp`, ABORT: "Need $EXPECTED_TP free GPUs but only $FREE_GPUS available."

3. **Stale vLLM Process Detection**:
```bash
STALE=$($SSH "pgrep -af 'vllm serve|vllm.entrypoints' 2>/dev/null | grep -v pgrep || true")
```
If stale processes found (non-empty after filtering), WARN and list PIDs. Offer cleanup before deploy.

4. **Model Weight Path** (optional):
```bash
MODEL_PATH=$(echo "$DEPLOY_CONFIG" | jq -r '.model_path // empty')
if [ -n "$MODEL_PATH" ]; then
  $SSH "test -d '$MODEL_PATH' && echo 'exists' || echo 'missing'"
fi
```
If configured and missing, WARN: "Model path $MODEL_PATH not found on target."

5. **CUDA Driver Version** (optional):
```bash
MIN_DRIVER=$(echo "$INIT" | jq -r '.cluster.hardware.min_driver // empty')
if [ -n "$MIN_DRIVER" ]; then
  DRIVER=$($SSH "nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1")
fi
```
If driver version < min_driver, WARN.

Report:
```
GPU Environment: $CLUSTER_NAME
  GPUs: $TOTAL total, $FREE_GPUS free | Driver: $DRIVER | Max temp: ${MAX_TEMP}°C
  Model cache: ${MODEL_PATH:-N/A}
  Status: READY / WARN / ABORT
```

Gate: ABORT-level issues stop deploy. WARN-level issues display and continue.
</step>

<step name="COLLISION_CHECK">
Check if another feature is already deployed to the same cluster/namespace.

```bash
ALL_FEATURES=$(echo "$INIT" | jq -r '.all_clusters // empty')
```

Scan all features in `.dev.yaml` for:
- Same `cluster` value as current deploy target
- Different feature name than current feature
- Phase is `deploy`, `verify`, or `observe` (actively using the cluster)

If collision detected:
```
⚠️  Feature "$OTHER_FEATURE" is already deployed to $CLUSTER_NAME / $NAMESPACE
    Tag: $OTHER_TAG | Phase: $OTHER_PHASE

    Proceeding will overwrite the existing deployment.
    Continue? [Y/n]
```

For `safety: prod` clusters, require explicit confirmation even without collision.
</step>

Gate: `current_tag` must exist (build completed). If not, abort: "No built image. Run `/devflow build` first."
Gate: `active_cluster` must be set. If not, abort: "No cluster configured. Run `/devflow cluster use <name>`."
</step>

<step name="CODE_VALIDATION">
Pre-deploy code-level validation. Ensures the code is importable and passes
basic sanity before deploying. Skip if `$ARGUMENTS` contains `--skip-code-validation`
or `--force`.

```bash
BUILD_SSH=$(echo "$INIT" | jq -r '.build_server.ssh // empty')
BUILD_DIR=$(echo "$INIT" | jq -r '.build_server.work_dir // empty')
```
If `BUILD_SSH` or `BUILD_DIR` is empty, skip this step silently (no build server configured).

1. **Compile Check** (Python syntax):
```bash
echo "Code validation: compile check..."
COMPILE_RESULT=$($BUILD_SSH "cd $BUILD_DIR && python3 -m compileall -q vllm/ 2>&1")
COMPILE_EXIT=$?
```
If exit code != 0, ABORT with the syntax error output.

2. **Import Smoke Check**:
```bash
echo "Code validation: import check..."
IMPORT_RESULT=$($BUILD_SSH "cd $BUILD_DIR && python3 -c '
import vllm
from vllm import LLM, SamplingParams
from vllm.config import VllmConfig
print(\"vllm_version:\", vllm.__version__)
' 2>&1")
IMPORT_EXIT=$?
```
If exit code != 0, ABORT with the import error.

3. **Targeted Tests** (optional, from config):
```bash
VALIDATION_TESTS=$(echo "$DEPLOY_CONFIG" | jq -r '.validation_tests // empty')
VALIDATION_GATE=$(echo "$DEPLOY_CONFIG" | jq -r '.validation_tests_gate // false')
if [ -n "$VALIDATION_TESTS" ]; then
  echo "Code validation: targeted tests..."
  TEST_RESULT=$($BUILD_SSH "cd $BUILD_DIR && python3 -m pytest $VALIDATION_TESTS -x -q --timeout=60 2>&1")
  TEST_EXIT=$?
  if [ $TEST_EXIT -ne 0 ]; then
    if [ "$VALIDATION_GATE" == "true" ]; then
      ABORT with test output
    else
      WARN: "Targeted tests failed (non-blocking):" + test output
    fi
  fi
fi
```

Report:
```
Code Validation:
  Compile check: PASS
  Import check: PASS (vllm X.Y.Z)
  Targeted tests: PASS / WARN / SKIP
```

Gate: compileall + import must pass. Targeted tests configurable.
</step>

<step name="PRE_DEPLOY_HOOKS">
Execute pre-deploy hooks and learned hooks.

Execute pre_deploy checks from `.hooks.pre_deploy` in .dev.yaml:
For each hook in `.hooks.pre_deploy`, perform the check inline:
- `pre_deploy_yaml_validate`: Validate deploy YAML syntax and required fields (namespace, image tag, resource limits)
- `pre_deploy_tag_exists`: Verify the image tag exists in the registry
- (Other hooks as listed in config — read the hook name and perform the corresponding verification)

Execute learned checks for pre_deploy phase:
For each entry in `.hooks.learned` where `trigger == "pre_deploy"`:
- Read the `rule` field and verify it inline
- Example rules: "YAML port name <= 15 chars", "namespace must match .dev.yaml cluster config"
- If the rule is unclear, show it to the user and ask for guidance

Load experience anti-patterns:
```bash
VAULT=$(echo "$INIT" | jq -r '.vault')
DEVLOG_GROUP=$(echo "$INIT" | jq -r '.devlog.group')
EXPERIENCE_DIR="$VAULT/$DEVLOG_GROUP/experience"
```
Scan `$EXPERIENCE_DIR/` for files matching deploy-related topics (e.g., `k8s-deploy-lessons.md`, `*-patterns.md`).
Extract all **Anti-patterns** sections and display as warnings:
```
⚠ 已知部署陷阱 (来自历史经验):
  ✗ <anti-pattern 1> — <why it's wrong>
  ✗ <anti-pattern 2> — <why it's wrong>
```
This is informational — does not block deploy, but ensures the operator is aware before proceeding.

Gate: ALL pre_deploy hooks must pass.
</step>

<step name="NAMESPACE_SAFETY">
Verify namespace and apply safety checks.

```bash
# CRITICAL: Verify namespace is correct
echo "Target namespace: $NAMESPACE"
echo "Target cluster: $CLUSTER_NAME"
```

If `safety == "prod"`:
```
[PRODUCTION CLUSTER]
You are deploying to a PRODUCTION cluster: $CLUSTER_NAME
Namespace: $NAMESPACE
Image: $CURRENT_TAG

Type the namespace name to confirm: _____
```
Require user to type the exact namespace name. Mismatch aborts.

If `safety == "normal"`:
```
Deploying $CURRENT_TAG to $CLUSTER_NAME/$NAMESPACE
Confirm? (yes/abort)
```
</step>

<step name="EXECUTE_DEPLOY">
Run the deployment based on configured strategy.

**Strategy: delete-then-apply** (typical for DGD):
```bash
# Step 1: Delete existing resource
RESOURCE_KIND=$(echo "$DEPLOY_CONFIG" | jq -r '.resource_kind // "deployment"')
DGD_NAME=$(echo "$DEPLOY_CONFIG" | jq -r '.dgd_name')
echo "Deleting existing $RESOURCE_KIND/$DGD_NAME..."
$SSH kubectl delete "$RESOURCE_KIND" "$DGD_NAME" -n "$NAMESPACE" --ignore-not-found=true

# Step 2: Wait for cleanup
echo "Waiting for pods to terminate..."
$SSH kubectl wait --for=delete pod -l "app=$DGD_NAME" -n "$NAMESPACE" --timeout=120s 2>/dev/null || true

# Step 3: Apply new deployment
YAML_FILE=$(echo "$DEPLOY_CONFIG" | jq -r '.yaml_file')
echo "Applying deployment from $YAML_FILE..."
$SSH kubectl apply -f "$YAML_FILE" -n "$NAMESPACE"
```

**Strategy: apply** (standard rolling update):
```bash
YAML_FILE=$(echo "$DEPLOY_CONFIG" | jq -r '.yaml_file')
$SSH kubectl apply -f "$YAML_FILE" -n "$NAMESPACE"
```

**Strategy: custom** (project-specific commands):
```bash
DEPLOY_CMD=$(echo "$DEPLOY_CONFIG" | jq -r '.commands.default')
bash -c "$DEPLOY_CMD"
```

Execute with `run_in_background=true` if expected to be long-running.
</step>

<step name="POST_DEPLOY_HOOKS">
Run post-deploy hooks (warn on failure, don't abort).

Execute post_deploy checks from `.hooks.post_deploy` in .dev.yaml:
For each hook in `.hooks.post_deploy`, perform the check inline:
- `post_deploy_label_services`: Label headless services with dynamo discovery labels
- `wait_all_pods_ready`: Wait for all pods to reach Running+Ready state
- (Other hooks as listed in config — read the hook name and perform the corresponding action)
Post-deploy hooks are non-blocking: warn on failure but do not abort.
</step>

<step name="WAIT_FOR_READY">
Wait for pods to be ready with timeout monitoring.

```bash
echo "Waiting for pods to become ready..."
TIMEOUT=$(echo "$INIT" | jq -r '.tuning.deploy_timeout')
ELAPSED=0
INTERVAL=$(echo "$INIT" | jq -r '.tuning.deploy_poll_interval')

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

  # CRITICAL: If stuck past timeout, check logs immediately
  if [ $ELAPSED -ge $TIMEOUT ]; then
    echo "[ALERT] Pods stuck after ${TIMEOUT}s. Checking logs..."
    PROBLEM_POD=$($SSH kubectl get pods -n "$NAMESPACE" -l "app=$DGD_NAME" --no-headers | head -1 | awk '{print $1}')
    $SSH kubectl logs "$PROBLEM_POD" -n "$NAMESPACE" --tail=50
    echo "Consider: /devflow debug deploy-stuck"
    break
  fi

  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done
```

Gate: If pods not ready after timeout, warn but don't fail (user may want to investigate).

After pods are ready, perform application-level readiness checks:

4. **Model-Loaded Health Check**:
```bash
SVC_URL=$(echo "$DEPLOY_CONFIG" | jq -r '.service_url // empty')
MODEL_NAME=$(echo "$DEPLOY_CONFIG" | jq -r '.model_name // empty')
if [ -n "$SVC_URL" ]; then
  echo "Waiting for vLLM model to load..."
  HEALTH_START=$(date +%s)
  HEALTH_TIMEOUT=600
  HEALTH_ELAPSED=0
  while [ $HEALTH_ELAPSED -lt $HEALTH_TIMEOUT ]; do
    HEALTH_CODE=$($SSH "curl -s -o /dev/null -w '%{http_code}' http://$SVC_URL/health 2>/dev/null" || echo "000")
    if [ "$HEALTH_CODE" = "200" ]; then
      HEALTH_TIME=$(( $(date +%s) - HEALTH_START ))
      echo "vLLM health endpoint: OK (model loaded in ${HEALTH_TIME}s)"
      break
    fi
    sleep 10
    HEALTH_ELAPSED=$(( $(date +%s) - HEALTH_START ))
  done
  if [ $HEALTH_ELAPSED -ge $HEALTH_TIMEOUT ]; then
    echo "[WARN] vLLM /health did not respond after ${HEALTH_TIMEOUT}s"
    echo "Model may still be loading. Check logs: kubectl logs <pod> -n $NAMESPACE"
  fi
fi
```
vLLM model loading can take several minutes after the container starts.
The /health endpoint only returns 200 after the engine is ready.

5. **First-Request Validation**:
```bash
if [ -n "$SVC_URL" ] && [ -n "$MODEL_NAME" ]; then
  echo "Sending first validation request..."
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
  fi
fi
```
Verify the model can actually generate output. Catches OOM on first
forward pass, missing tokenizer, or configuration errors.
</step>

<step name="UPDATE_STATE">
Update .dev.yaml and checkpoint.

Update `.dev.yaml`:
- Set `project.phase` to `deploy`
- Record deploy timestamp

Checkpoint (@references/shared-patterns.md#checkpoint):
```bash
node "$DEVFLOW_BIN" checkpoint \
  --action "deploy" \
  --summary "Deployed $CURRENT_TAG to $CLUSTER_NAME/$NAMESPACE ($STRATEGY)"
```

Output:
```
Deploy complete: $CURRENT_TAG -> $CLUSTER_NAME/$NAMESPACE
Strategy: $STRATEGY
Pods: $RUNNING/$TOTAL ready
Model loaded: ${HEALTH_TIME:-N/A}s
First request: ${FIRST_LATENCY:-N/A}ms

Next: /devflow verify --smoke
```
</step>

<step name="REFLECTION">
@references/shared-patterns.md#experience-sink

Detection criteria: pod stuck >5min, hook warnings, stale_pod_cleanup needed, strategy retry, post-deploy warnings
Target file: `k8s-deploy-lessons.md`
Context fields: `tag=$CURRENT_TAG, cluster=$CLUSTER_NAME, namespace=$NAMESPACE, strategy=$STRATEGY`
</step>
</process>
