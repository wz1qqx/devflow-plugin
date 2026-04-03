# Workflow: verify

<purpose>Post-deploy verification through smoke tests, benchmarks, accuracy checks, or full verification suites. All commands are config-driven from `.dev.yaml` fields `verify` and `benchmark`.</purpose>
<core_principle>Verify before claiming success. Never guess commands — if config is missing, abort with a clear message telling the user which field to add.</core_principle>

<process>
<step name="INIT" priority="first">
Parse verification mode and load configuration.

```bash
# Auto-discover devflow CLI (marketplace or local install)
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)

INIT=$(node "$DEVFLOW_BIN" init verify)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
```

Extract verify config:
```bash
CURRENT_TAG=$(echo "$INIT" | jq -r '.feature.current_tag')
CLUSTER_NAME=$(echo "$INIT" | jq -r '.cluster.name')
NAMESPACE=$(echo "$INIT" | jq -r '.cluster.namespace')
SSH=$(echo "$INIT" | jq -r '.cluster.ssh')
REGRESSION_THRESHOLD=$(echo "$INIT" | jq -r '.tuning.regression_threshold')

# Verify config
SMOKE_CMD=$(echo "$INIT" | jq -r '.verify.smoke_cmd // empty')
SMOKE_COUNT=$(echo "$INIT" | jq -r '.verify.smoke_count // 5')
WARMUP_COUNT=$(echo "$INIT" | jq -r '.verify.warmup_count // 3')
POD_SELECTOR=$(echo "$INIT" | jq -r '.verify.pod_selector // empty')

# Benchmark config
BENCH_CMD=$(echo "$INIT" | jq -r '.benchmark.mtb_cmd // empty')
BENCH_OUTPUT_DIR=$(echo "$INIT" | jq -r '.benchmark.output_dir // "bench-results"')

# Accuracy config
ACCURACY_CMD=$(echo "$INIT" | jq -r '.verify.accuracy.command // empty')
ACCURACY_BASELINE=$(echo "$INIT" | jq -r '.verify.accuracy.baseline // empty')
ACCURACY_THRESHOLD=$(echo "$INIT" | jq -r '.verify.accuracy.threshold // empty')
ACCURACY_OUTPUT_DIR=$(echo "$INIT" | jq -r '.verify.accuracy.output_dir // "bench-results"')
```

Parse mode from `$ARGUMENTS`. Supported flags (all optional, user specifies which to run):
- `--smoke` — Quick health check: pod health + warmup + measure
- `--bench` — Performance benchmark via `benchmark.mtb_cmd`
- `--accuracy` — Output comparison via `verify.accuracy.command`
- `--profile` — Torch profiler trace + layerwise analysis (Phase 3)
- `--kernel` — Nsight kernel classification + hotspot analysis (Phase 4)
- `--full` — Run all specified modes + cross-analysis report

**If NO flag provided**: present available modes via AskUserQuestion.
All modes are optional. The user decides what to run. Just show what's available.

Gate: `CURRENT_TAG` must exist. If empty: "No current_tag set. Run `/devflow build` first."
</step>

<step name="SMOKE_TEST">
Verification gradient with four gated levels. Runs for `--smoke` and `--full`.
Each level gates the next — failure at any level aborts remaining levels.

**L1 — Health Gate**:
```bash
# Pod readiness (if cluster configured and POD_SELECTOR set)
if [ -n "$POD_SELECTOR" ]; then
  PODS=$($SSH kubectl get pods -n "$NAMESPACE" -l "$POD_SELECTOR" -o json)
  READY=$(echo "$PODS" | jq '[.items[].status.containerStatuses[]?.ready] | all')
  TOTAL=$(echo "$PODS" | jq '.items | length')
  if [ "$READY" != "true" ] || [ "$TOTAL" -eq 0 ]; then
    echo "[L1 FAIL] Pods not ready ($TOTAL pods, ready=$READY)"
    ABORT: "Pods not ready. Check deployment status."
  fi
  echo "[L1 PASS] Pods: $TOTAL ready"
fi

# vLLM health endpoint (if service_url configured)
SVC_URL=$(echo "$INIT" | jq -r '.deploy.service_url // empty')
if [ -n "$SVC_URL" ]; then
  HEALTH_CODE=$($SSH "curl -s -o /dev/null -w '%{http_code}' http://$SVC_URL/health 2>/dev/null" || echo "000")
  if [ "$HEALTH_CODE" != "200" ]; then
    echo "[L1 FAIL] /health returned HTTP $HEALTH_CODE at $SVC_URL"
    ABORT: "vLLM server not healthy. Model may not be loaded."
  fi
  echo "[L1 PASS] /health: HTTP 200"
fi
```
Gate: If pod not ready or /health fails, ABORT. No point running requests.

**L2 — Warmup**:
```bash
echo "[L2] Warmup: $WARMUP_COUNT requests (discarding results)..."
for i in $(seq 1 $WARMUP_COUNT); do
  echo "  Warmup $i/$WARMUP_COUNT..."
  bash -c "$SMOKE_CMD" > /dev/null 2>&1 || true
done
echo "[L2 PASS] Warmup complete"
```
Purpose: ensure CUDA graphs compiled, KV cache allocated, lazy init done.
Gate: `SMOKE_CMD` must be non-empty. If empty: "No `verify.smoke_cmd` in .dev.yaml."

**L3 — Measure**:

If `SVC_URL` is configured, prefer `vllm bench serve` for standardized metrics:
```bash
MODEL_NAME=$(echo "$INIT" | jq -r '.deploy.model_name // empty')
if [ -n "$SVC_URL" ] && [ -n "$MODEL_NAME" ]; then
  echo "[L3] Measuring with vllm bench serve ($SMOKE_COUNT requests)..."
  $SSH "vllm bench serve \
    --backend openai \
    --base-url http://$SVC_URL \
    --model $MODEL_NAME \
    --dataset-name random \
    --random-input-len 128 \
    --random-output-len 64 \
    --num-prompts $SMOKE_COUNT \
    --request-rate inf \
    --percentile-metrics ttft,tpot,itl,e2el \
    --metric-percentiles 50,90,99 \
    --save-result \
    --result-dir /tmp/smoke-results \
    --result-filename smoke-${CURRENT_TAG}.json"
fi
```

Otherwise fall back to `SMOKE_CMD` with timing:
```bash
if [ -z "$SVC_URL" ] || [ -z "$MODEL_NAME" ]; then
  echo "[L3] Measuring with smoke_cmd ($SMOKE_COUNT requests)..."
  FAILURES=0
  for i in $(seq 1 $SMOKE_COUNT); do
    echo "  Request $i/$SMOKE_COUNT..."
    START_MS=$(date +%s%3N)
    bash -c "$SMOKE_CMD" > /dev/null 2>&1
    EXIT=$?
    END_MS=$(date +%s%3N)
    LATENCY=$((END_MS - START_MS))
    if [ $EXIT -ne 0 ]; then
      echo "    FAILED (exit=$EXIT, ${LATENCY}ms)"
      FAILURES=$((FAILURES + 1))
    else
      echo "    OK (${LATENCY}ms)"
    fi
  done
  if [ $FAILURES -gt 0 ]; then
    echo "[L3 FAIL] $FAILURES/$SMOKE_COUNT requests failed"
    ABORT: "Smoke test failed. Suggestion: /devflow debug verify-smoke"
  fi
fi
echo "[L3 PASS] All requests succeeded"
```
Using `vllm bench serve` gives consistent TTFT/TPOT/ITL metrics in the same
format as the full benchmark, enabling direct comparison.

**L4 — Report + Transfer**:
```
Smoke Test: $CURRENT_TAG (verification gradient)
  L1 Health:  PASS (pods ready, /health OK)
  L2 Warmup:  PASS ($WARMUP_COUNT requests)
  L3 Measure: PASS ($SMOKE_COUNT requests)
    [if vllm bench serve was used, show TTFT/TPOT/E2E percentile table]
  Status: PASS
```

If `vllm bench serve` saved results on the remote server, transfer back to local:
```bash
mkdir -p "$BENCH_OUTPUT_DIR"
scp "$SSH_HOST:/tmp/smoke-results/smoke-${CURRENT_TAG}.json" "$BENCH_OUTPUT_DIR/" 2>/dev/null && \
  echo "Smoke results saved: $BENCH_OUTPUT_DIR/smoke-${CURRENT_TAG}.json"
```
</step>

<step name="BENCHMARK">
Full benchmark execution with resume support. Runs for `--bench` and `--full`.

Gate: `BENCH_CMD` must be non-empty. If empty: "No `benchmark.mtb_cmd` configured in .dev.yaml. Add it to run benchmarks."

**Resume check** — before running, scan for existing results:
```bash
mkdir -p "$BENCH_OUTPUT_DIR"
EXISTING=$(ls "$BENCH_OUTPUT_DIR"/mtb-${CURRENT_TAG}-run*.txt 2>/dev/null | sort -t. -k1 | tail -1)
if [ -n "$EXISTING" ]; then
  LAST_RUN_NUM=$(echo "$EXISTING" | grep -o 'run[0-9]*' | grep -o '[0-9]*')
  echo "Found existing benchmark result: $EXISTING (run $LAST_RUN_NUM)"
fi
```

If existing result found, present options via AskUserQuestion:
- **resume**: use existing result for comparison, run next iteration (run N+1)
- **restart**: delete existing results for this tag, re-run from scratch
- **skip**: use existing result as-is, proceed to comparison

If `$ARGUMENTS` contains `--resume`, auto-select resume without prompting.
If `$ARGUMENTS` contains `--restart`, auto-select restart without prompting.

**Execute benchmark**:
```bash
NEXT_RUN=$((LAST_RUN_NUM + 1))
RESULT_FILE="$BENCH_OUTPUT_DIR/mtb-${CURRENT_TAG}-run${NEXT_RUN}.txt"
REPORT_FILE="$BENCH_OUTPUT_DIR/mtb-${CURRENT_TAG}-run${NEXT_RUN}-report.txt"

echo "Starting benchmark (run $NEXT_RUN): $BENCH_CMD"
BENCH_START=$(date +%s)
bash -c "$BENCH_CMD" | tee "$RESULT_FILE"
BENCH_EXIT=$?
BENCH_END=$(date +%s)
BENCH_DURATION=$((BENCH_END - BENCH_START))
echo "Benchmark completed in ${BENCH_DURATION}s (exit=$BENCH_EXIT)"
```

Execute with `run_in_background=true` for long runs.
If the benchmark is interrupted (non-zero exit, SSH timeout), the partial
`$RESULT_FILE` is preserved. Next run with `--resume` will use run N+1.

**Compare with previous tag**:
```bash
PREV_TAG=$(echo "$INIT" | jq -r '.build_history[-2].tag // empty')
if [ -n "$PREV_TAG" ]; then
  PREV_RESULT=$(ls "$BENCH_OUTPUT_DIR"/mtb-${PREV_TAG}-run*.txt 2>/dev/null | sort | tail -1)
  if [ -n "$PREV_RESULT" ]; then
    echo "Comparing: $RESULT_FILE vs $PREV_RESULT"
    # Extract and compare key metrics (TTFT, TPOT, throughput, etc.)
  fi
fi
```

**Regression check** (threshold: `$REGRESSION_THRESHOLD`%, default 20%):
If any key metric regressed beyond threshold:
```
[ANOMALY] Performance regression detected:
  <metric>: <old> -> <new> (+<pct>%)

Options:
  1. /devflow debug bench-regression  — investigate root cause
  2. /devflow verify --profile        — collect profiler trace for comparison
  3. Continue                         — accept and proceed
```

**Transfer results to local**:
If the benchmark ran on a remote server, copy results back:
```bash
mkdir -p "$BENCH_OUTPUT_DIR"
# If RESULT_FILE is remote, scp it back
scp "$SSH_HOST:$RESULT_FILE" "$BENCH_OUTPUT_DIR/" 2>/dev/null
scp "$SSH_HOST:$REPORT_FILE" "$BENCH_OUTPUT_DIR/" 2>/dev/null
echo "Bench results saved: $BENCH_OUTPUT_DIR/"
```

**Report**:
```
Benchmark: $CURRENT_TAG (run $NEXT_RUN)
  Duration: ${BENCH_DURATION}s
  Results: $BENCH_OUTPUT_DIR/mtb-${CURRENT_TAG}-run${NEXT_RUN}.txt
  vs $PREV_TAG: <comparison summary or "no previous result">
  Verdict: PASS / REGRESSION
```
</step>

<step name="ACCURACY_TEST">
Accuracy verification. Runs for `--accuracy` and `--full`.

Gate: `ACCURACY_CMD` must be non-empty. If empty: "No `verify.accuracy.command` configured in .dev.yaml. Add it to run accuracy tests."

```bash
mkdir -p "$ACCURACY_OUTPUT_DIR"
echo "Running accuracy verification: $ACCURACY_CMD"
bash -c "$ACCURACY_CMD"
```

Save results: `$ACCURACY_OUTPUT_DIR/accuracy-${CURRENT_TAG}-run${N}.json`

Compare against baseline (`$ACCURACY_BASELINE`):
- Within `$ACCURACY_THRESHOLD`%: PASS
- Exceeds threshold:
  ```
  [ANOMALY] Accuracy deviation detected:
    Deviation: <pct>% (threshold: $ACCURACY_THRESHOLD%)
  Enter debug mode? /devflow debug accuracy-regression
  ```
</step>

<step name="PROFILE_ANALYSIS">
Torch profiler trace collection + kernel breakdown analysis.
Runs for `--profile` and `--full`. Ref: @references/vllm-profiling-conventions.md

Gate: `SVC_URL` must be configured (`deploy.service_url` in .dev.yaml).

**Phase 1 — Profiler Readiness Check**:
```bash
PROFILE_DIR=$(echo "$INIT" | jq -r '.verify.profile.trace_dir // "/tmp/vllm_profile_'$CURRENT_TAG'"')
PROFILE_PROMPTS=$(echo "$INIT" | jq -r '.verify.profile.num_prompts // 10')
PROFILE_RATE=$(echo "$INIT" | jq -r '.verify.profile.request_rate // 4')
PROFILE_INPUT_LEN=$(echo "$INIT" | jq -r '.verify.profile.input_len // 128')
PROFILE_OUTPUT_LEN=$(echo "$INIT" | jq -r '.verify.profile.output_len // 64')
```

Check if server has profiler endpoint:
```bash
# Test with a dry-run — if the endpoint doesn't exist, server returns 404/405
TEST_CODE=$($SSH "curl -s -o /dev/null -w '%{http_code}' -X POST http://$SVC_URL/start_profile 2>/dev/null" || echo "000")
if [ "$TEST_CODE" = "404" ] || [ "$TEST_CODE" = "405" ] || [ "$TEST_CODE" = "000" ]; then
  echo "[WARN] Profiler endpoint not available at $SVC_URL"
  echo "Server must be started with: --profiler-config '{\"profiler\": \"torch\", \"torch_profiler_dir\": \"<dir>\"}'"
  echo "Skipping profile analysis."
  # Skip remaining phases
fi
```
If start_profile returned 200, profiler is now active — proceed to Phase 2.

**Phase 2 — Trace Collection**:

IMPORTANT: Use direct curl requests, NOT `vllm bench serve`.
`vllm bench serve` has tokenizer initialization delay that can exhaust
the profiler's active window before actual requests are sent.

```bash
echo "Profiler active. Sending $PROFILE_PROMPTS requests..."
MODEL_NAME=$(echo "$INIT" | jq -r '.deploy.model_name // empty')

for i in $(seq 1 $PROFILE_PROMPTS); do
  $SSH "curl -sf http://$SVC_URL/v1/completions \
    -H 'Content-Type: application/json' \
    -d '{\"model\": \"$MODEL_NAME\", \"prompt\": \"Explain the concept of\", \"max_tokens\": $PROFILE_OUTPUT_LEN, \"temperature\": 0}'" > /dev/null 2>&1
  echo "  Request $i/$PROFILE_PROMPTS done"
done

echo "Stopping profiler..."
$SSH "curl -sf -X POST http://$SVC_URL/stop_profile"
sleep 3
```
Note: profiling adds significant overhead (10-30%). Latency numbers during
profiling should NOT be compared with non-profiled runs.
The goal is kernel breakdown, not latency measurement.

**Phase 3 — Trace Discovery and Kernel Breakdown**:
```bash
echo "Checking trace output..."
TRACE_FILES=$($SSH "ls $PROFILE_DIR/*.json.gz $PROFILE_DIR/*.trace.json.gz 2>/dev/null")
PROFILER_TXT=$($SSH "ls $PROFILE_DIR/profiler_out_*.txt 2>/dev/null | head -1")
```

vLLM's torch profiler generates:
- `rank0.*.pt.trace.json.gz` — EngineCore trace (main GPU timeline)
- `*.async_llm.*.pt.trace.json.gz` — API server trace
- `profiler_out_0.txt` — kernel time summary table (`key_averages()`)

Parse `profiler_out_0.txt` for kernel breakdown:
```bash
if [ -n "$PROFILER_TXT" ]; then
  echo ""
  echo "=== Kernel Breakdown (from profiler_out_0.txt) ==="
  $SSH "head -40 $PROFILER_TXT"
fi
```

The profiler_out_0.txt contains Self CUDA %, Self CUDA time, and call count
per kernel — this is the primary analysis artifact.

Classify top kernels into categories:
- **gemm**: `aten::mm`, `cublas`, `cutlass`, matmul kernels
- **attention**: `flash_fwd`, `flash_bwd`, `fmha`, attention kernels
- **norm**: `rmsnorm`, `layernorm`, `fused_*_norm` Triton kernels
- **activation**: `silu`, `gelu`, `mul_silu`, activation Triton kernels
- **cache**: `reshape_and_cache`, cache-related kernels
- **memory**: `Memcpy`, `Memset`
- **other**: everything else

**Phase 4 — Comparison** (if previous profile exists):
```bash
PREV_TAG=$(echo "$INIT" | jq -r '.build_history[-2].tag // empty')
PREV_PROFILE_TXT=$($SSH "ls /tmp/vllm_profile_${PREV_TAG}/profiler_out_*.txt 2>/dev/null | head -1" || true)
if [ -n "$PREV_PROFILE_TXT" ]; then
  echo ""
  echo "=== Profile Comparison: $CURRENT_TAG vs $PREV_TAG ==="
  # Compare top kernel categories between current and previous
  # Flag categories with >20% change in Self CUDA %
fi
```

**Phase 5 — Copy results to local bench-results/**:
```bash
mkdir -p "$BENCH_OUTPUT_DIR/profile-${CURRENT_TAG}"
$SSH "ls $PROFILE_DIR/" | while read f; do
  scp "$SSH_HOST:$PROFILE_DIR/$f" "$BENCH_OUTPUT_DIR/profile-${CURRENT_TAG}/" 2>/dev/null
done
```

**Extension point** — `verify.profile.analyzers` in .dev.yaml:
```yaml
# Future: plug in custom analysis scripts
verify:
  profile:
    analyzers:
      - name: layerwise
        command: "python3 tools/profiler/visualize_layerwise_profile.py {trace} --output {output_dir}/layerwise.html"
      - name: custom-breakdown
        command: "python3 scripts/analyze_vllm_profile.py {trace}"
```
If analyzers are configured, run each one after trace collection.
Currently this is a placeholder — the default analysis uses profiler_out_0.txt directly.

**Report**:
```
Profile Analysis: $CURRENT_TAG

Trace files:
  $PROFILE_DIR/rank0.*.pt.trace.json.gz (for Perfetto: https://ui.perfetto.dev)
  $PROFILE_DIR/profiler_out_0.txt (kernel summary)

Top Kernels (by Self CUDA %):
  1. <kernel_name> — <pct>% (<category>)
  2. ...
  5. ...

Category Breakdown:
  | Category   | Self CUDA % | Notes              |
  |------------|-------------|--------------------|
  | gemm       | XX%         |                    |
  | attention  | XX%         |                    |
  | norm       | XX%         |                    |
  | ...        |             |                    |

vs $PREV_TAG: <delta summary or "no previous profile">

Saved: bench-results/profile-${CURRENT_TAG}/
```
</step>

<step name="KERNEL_ANALYSIS">
Nsight Systems kernel-level GPU profiling and classification.
Runs for `--kernel`. Ref: @references/vllm-profiling-conventions.md

This mode uses `vllm bench latency` (offline, no running server needed) under
`nsys profile` to capture detailed GPU kernel execution traces.

**Phase 1 — Nsight Availability Check**:
```bash
NSYS_PATH=$($SSH "which nsys 2>/dev/null || ls /usr/local/cuda*/bin/nsys 2>/dev/null | tail -1")
if [ -z "$NSYS_PATH" ]; then
  echo "[ABORT] nsys not found on target node."
  echo "Install CUDA toolkit or add nsys to PATH."
  # Skip remaining phases
fi
echo "nsys found: $NSYS_PATH"
NSYS_VERSION=$($SSH "$NSYS_PATH --version 2>&1" | head -1)
echo "Version: $NSYS_VERSION"
```

**Phase 2 — Kernel Trace Collection**:

Uses `vllm bench latency --enforce-eager` for clean kernel attribution
(no CUDA graph merging). The model, batch size, and sequence lengths
are specified by the user or read from config.

```bash
MODEL_NAME=$(echo "$INIT" | jq -r '.deploy.model_name // empty')
KERNEL_BATCH=$(echo "$INIT" | jq -r '.verify.kernel.batch_size // 1')
KERNEL_INPUT_LEN=$(echo "$INIT" | jq -r '.verify.kernel.input_len // 128')
KERNEL_OUTPUT_LEN=$(echo "$INIT" | jq -r '.verify.kernel.output_len // 32')
KERNEL_ITERS=$(echo "$INIT" | jq -r '.verify.kernel.num_iters // 3')
NSYS_OUTPUT="/tmp/vllm_nsys_${CURRENT_TAG}"

echo "Collecting kernel trace with nsys..."
$SSH "CUDA_VISIBLE_DEVICES=0 $NSYS_PATH profile \
  -t cuda \
  -o $NSYS_OUTPUT \
  -f true \
  vllm bench latency \
    --model $MODEL_NAME \
    --batch-size $KERNEL_BATCH \
    --input-len $KERNEL_INPUT_LEN \
    --output-len $KERNEL_OUTPUT_LEN \
    --num-iters $KERNEL_ITERS \
    --enforce-eager \
    --load-format dummy"
```

Key flags explained:
- `--enforce-eager`: disable CUDA graph so individual kernels are visible
- `--load-format dummy`: skip model weight download (uses random weights, fine for kernel profiling)
- `-t cuda`: trace only CUDA API and kernels (minimal overhead)

**Phase 3 — Kernel Summary Extraction**:
```bash
echo "Extracting kernel summary..."
KERNEL_CSV=$($SSH "$NSYS_PATH stats ${NSYS_OUTPUT}.nsys-rep \
  --report cuda_gpu_kern_sum \
  --format csv 2>&1 | grep -v '^Processing\|^NOTICE\|^Generating\|^$'")
```

The CSV contains: Time(%), Total Time(ns), Instances, Avg(ns), Med(ns), Min(ns), Max(ns), StdDev(ns), Name

**Phase 4 — Kernel Classification**:

Classify each kernel into categories by name pattern matching:
- **gemm**: `gemm`, `gemv`, `cublas`, `cutlass` (linear layers)
- **attention**: `flash_fwd`, `flash_bwd`, `fmha` (attention compute)
- **norm**: `rms_norm`, `fused_add_rms_norm`, `layernorm` (normalization)
- **activation**: `act_and_mul`, `silu`, `gelu` (activation functions)
- **rope**: `rotary_embedding` (positional encoding)
- **cache**: `reshape_and_cache` (KV cache operations)
- **sampling**: `topk_topp`, `SoftMaxForward`, `argmax` (sampling/logits)
- **memory**: `Memcpy`, `Memset`, `FillFunctor` (data movement)
- **other**: everything else

Aggregate per-category: sum Time(%) and instance count.
Flag any single category >40% as dominant hotspot.

**Phase 5 — Copy results to bench-results/**:
```bash
mkdir -p "$BENCH_OUTPUT_DIR/nsys-${CURRENT_TAG}"
scp "$SSH_HOST:${NSYS_OUTPUT}.nsys-rep" "$BENCH_OUTPUT_DIR/nsys-${CURRENT_TAG}/"
# Save kernel summary CSV locally
echo "$KERNEL_CSV" > "$BENCH_OUTPUT_DIR/nsys-${CURRENT_TAG}/kernel_summary.csv"
```

**Report**:
```
Kernel Analysis: $CURRENT_TAG
  nsys: $NSYS_VERSION
  Model: $MODEL_NAME (batch=$KERNEL_BATCH, in=$KERNEL_INPUT_LEN, out=$KERNEL_OUTPUT_LEN)
  Mode: enforce-eager (no CUDA graph)

GPU Time Breakdown:
  | Category   | Time %  | Instances | Top kernel                     |
  |------------|---------|-----------|--------------------------------|
  | gemm       | XX.X%   | NNNN      | ampere_bf16_s16816gemm...      |
  | attention  | XX.X%   | NNNN      | flash_fwd_splitkv_kernel...    |
  | norm       | XX.X%   | NNNN      | fused_add_rms_norm_kernel...   |
  | ...        |         |           |                                |

Hotspot: <category> dominates at XX% (if any >40%)

Saved: bench-results/nsys-${CURRENT_TAG}/
  kernel_summary.csv
  vllm_nsys_${CURRENT_TAG}.nsys-rep
```
</step>

<step name="FULL_ANALYSIS">
Cross-analysis report combining results from all executed modes.
Runs only for `--full`. Skipped if fewer than 2 modes were executed.

This step does NOT execute any modes itself — it reads the results
already produced by SMOKE_TEST, BENCHMARK, ACCURACY_TEST, PROFILE_ANALYSIS,
and KERNEL_ANALYSIS, then generates a unified report with cross-correlations.

**Collect results from executed modes**:
```bash
SMOKE_PASSED=<bool from SMOKE_TEST>
BENCH_VERDICT=<PASS|REGRESSION|SKIP from BENCHMARK>
ACCURACY_VERDICT=<PASS|DEVIATION|SKIP from ACCURACY_TEST>
PROFILE_AVAILABLE=<bool from PROFILE_ANALYSIS>
KERNEL_AVAILABLE=<bool from KERNEL_ANALYSIS>
```

**Cross-correlation analysis**:

If bench AND profile both ran:
- Compare bench regression metrics with profile kernel breakdown
- If TTFT regressed AND attention kernel time increased → "TTFT regression correlates with attention overhead increase"
- If TPOT regressed AND gemm time increased → "TPOT regression correlates with linear layer slowdown"
- If TPOT regressed AND norm time increased → "TPOT regression may correlate with normalization overhead"

If bench AND kernel both ran:
- Compare bench throughput with kernel hotspot distribution
- If throughput dropped AND gemm dominance increased → "Throughput drop correlates with GEMM becoming larger bottleneck"
- If latency increased AND memory operations grew → "Latency increase may relate to data movement overhead"

If bench regressed AND profile shows no obvious kernel change:
- "Regression detected but kernel distribution unchanged — suspect scheduling, memory pressure, or external interference"

If accuracy AND profile both ran:
- If accuracy deviated AND new kernels appear in profile → "Accuracy change may relate to different compute path"

**Generate verification report**:
```markdown
# Verification Report: $CURRENT_TAG

## Summary
| Mode     | Verdict           |
|----------|-------------------|
| smoke    | PASS / FAIL       |
| bench    | PASS / REGRESSION |
| accuracy | PASS / DEVIATION  |
| profile  | collected / skip  |
| kernel   | collected / skip  |

## Cross-Analysis Findings
<findings from correlation analysis above, or "No cross-correlations detected">

## Overall Verdict: PASS / PASS_WITH_WARNINGS / FAIL
- FAIL: smoke failed OR accuracy exceeded threshold
- PASS_WITH_WARNINGS: bench regression detected but within tolerance
- PASS: all executed modes passed

## Artifacts
- bench-results/mtb-${CURRENT_TAG}-run*.txt
- bench-results/profile-${CURRENT_TAG}/
- bench-results/nsys-${CURRENT_TAG}/
```

Save report to `bench-results/verify-report-${CURRENT_TAG}.md`.
</step>

<step name="POST_VERIFY">
Run post-verify hooks and update state.

Execute `.hooks.post_verify` checks from .dev.yaml (non-blocking: warn on failure).

Determine overall VERDICT from all executed modes:
- `FAIL`: smoke failed OR accuracy exceeded threshold
- `PASS_WITH_WARNINGS`: bench regression > threshold but other modes passed
- `PASS`: all executed modes passed

Update `.dev.yaml`:
- Set `feature.phase` to `verify`

Checkpoint (@references/shared-patterns.md#checkpoint):
```bash
node "$DEVFLOW_BIN" checkpoint \
  --action "verify" \
  --summary "Verify $VERDICT: $CURRENT_TAG ($MODE)"
```

Output:
```
Verification complete: $CURRENT_TAG
Mode: $MODE
Verdict: $VERDICT

Next: /devflow observe (for ongoing monitoring)
```
</step>

<step name="REFLECTION">
@references/shared-patterns.md#experience-sink

Detection criteria: benchmark regression > $REGRESSION_THRESHOLD%, accuracy deviation > threshold, smoke test failure
Target file: `verify-lessons.md`
Context fields: `tag=$CURRENT_TAG, verdict=$VERDICT, mode=$MODE`
</step>
</process>
