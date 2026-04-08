# Skill: vllm-opt

<purpose>vLLM performance optimization through benchmarking, torch profiling, and nsight kernel analysis. Manual trigger only -- not part of the standard pipeline.</purpose>
<core_principle>Measurement before optimization. 3x median with temperature=0 or it's noise. Never tune what you haven't profiled. Never profile what you haven't benchmarked.</core_principle>

<process>
<step name="INIT" priority="first">
Initialize optimization session and load configuration.

```bash
# Auto-discover devflow CLI (marketplace or local install)
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)

INIT=$(node "$DEVFLOW_BIN" init vllm-opt)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
FEATURE=$(echo "$INIT" | jq -r '.feature.name')
CURRENT_TAG=$(echo "$INIT" | jq -r '.feature.current_tag')
CLUSTER_NAME=$(echo "$INIT" | jq -r '.cluster.name')
SSH=$(echo "$INIT" | jq -r '.cluster.ssh')
SVC_URL=$(echo "$INIT" | jq -r '.deploy.service_url // empty')
MODEL_NAME=$(echo "$INIT" | jq -r '.deploy.model_name // empty')
BENCH_OUTPUT_DIR=$(echo "$INIT" | jq -r '.benchmark.output_dir // "bench-results"')
REGRESSION_THRESHOLD=$(echo "$INIT" | jq -r '.tuning.regression_threshold // 20')
```

Load build history and benchmark config:
```bash
PREV_TAG=$(echo "$INIT" | jq -r '.build_history[-2].tag // empty')
BENCH_CMD=$(echo "$INIT" | jq -r '.benchmark.mtb_cmd // empty')
```

Parse mode from `$ARGUMENTS`:
- `--bench` -- benchmark only
- `--profile` -- torch profiler via HTTP API
- `--kernel` -- nsight systems kernel analysis
- `--full` -- all modes + cross-correlation

**If NO flag provided**: present available modes via AskUserQuestion:
```
vLLM Optimization Modes:
  --bench    Benchmark with vllm bench serve, compare vs previous tag
  --profile  Torch profiler trace, kernel breakdown by category
  --kernel   Nsight systems profile, GPU kernel classification
  --full     All of the above + cross-correlation analysis

Select mode:
```

Gate: `CURRENT_TAG` must exist. If empty: "No current_tag. Run `/devflow build` first."
Gate: `SVC_URL` required for --bench and --profile. `MODEL_NAME` required for all modes.
</step>

<step name="GPU_ENV_CHECK">
Verify GPU environment is clean before any measurement.

```bash
# 1. GPU status
echo "=== GPU Environment Check ==="
$SSH "nvidia-smi --query-gpu=name,memory.used,memory.total,temperature.gpu,utilization.gpu --format=csv,noheader"

# 2. Stale processes (anything using GPU that shouldn't be)
STALE=$($SSH "nvidia-smi --query-compute-apps=pid,name,used_memory --format=csv,noheader 2>/dev/null")
if [ -n "$STALE" ]; then
  echo "[WARN] GPU processes found:"
  echo "$STALE"
  echo "These may affect measurements. Kill them? [y/N]"
fi

# 3. CUDA driver version
$SSH "nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1"

# 4. Model path verification
$SSH "ls -la $(echo "$INIT" | jq -r '.deploy.model_path // empty') 2>/dev/null | head -5"
```

If GPU memory utilization >10% before starting: warn user about potential interference.
If CUDA driver mismatch with toolkit: abort with version details.
</step>

<step name="BENCH" condition="--bench or --full">
Benchmark with vllm bench serve, compare against previous tag.

**Key flags for `vllm bench serve`**:
```bash
$SSH "vllm bench serve \
  --backend openai \
  --base-url http://$SVC_URL \
  --model $MODEL_NAME \
  --dataset-name random \
  --random-input-len 128 \
  --random-output-len 64 \
  --num-prompts 100 \
  --request-rate inf \
  --percentile-metrics ttft,tpot,itl,e2el \
  --metric-percentiles 50,90,99 \
  --save-result \
  --result-dir /tmp/bench-results \
  --result-filename bench-${CURRENT_TAG}.json"
```

**Run 3x for statistical validity** (median of medians):
```bash
for RUN in 1 2 3; do
  echo "=== Run $RUN/3 ==="
  # Execute benchmark, save as bench-${CURRENT_TAG}-run${RUN}.json
done
```

**Result JSON format** (key fields from vllm bench serve output):
```json
{
  "duration": 42.5,
  "completed": 100,
  "total_input_tokens": 12800,
  "total_output_tokens": 6400,
  "request_throughput": 2.35,
  "output_throughput": 150.6,
  "mean_ttft_ms": 45.2,
  "median_ttft_ms": 43.1,
  "p99_ttft_ms": 78.4,
  "mean_tpot_ms": 12.3,
  "median_tpot_ms": 11.8,
  "p99_tpot_ms": 22.1,
  "mean_itl_ms": 12.5,
  "median_itl_ms": 12.0,
  "p99_itl_ms": 23.4
}
```

**Compare vs previous tag** (if `$PREV_TAG` exists):
```bash
PREV_RESULT="$BENCH_OUTPUT_DIR/bench-${PREV_TAG}.json"
if [ -f "$PREV_RESULT" ]; then
  # Compare median TTFT, TPOT, throughput
  # Flag regressions > $REGRESSION_THRESHOLD%
fi
```

Regression threshold: `$REGRESSION_THRESHOLD`% (default 20%).
If any key metric regresses beyond threshold:
```
[REGRESSION] Performance degradation detected:
  TPOT median: 11.2ms -> 14.8ms (+32%)
  Threshold: 20%

Options:
  1. --profile  Collect torch profiler trace
  2. --kernel   Nsight kernel analysis
  3. Continue   Accept regression
```

Transfer results:
```bash
mkdir -p "$BENCH_OUTPUT_DIR"
scp "$SSH:/tmp/bench-results/bench-${CURRENT_TAG}*.json" "$BENCH_OUTPUT_DIR/"
```
</step>

<step name="PROFILE" condition="--profile or --full">
Torch profiler via vLLM HTTP API for kernel breakdown.

**HTTP API docs**:
- `POST /start_profile` -- begin collecting trace data
- `POST /stop_profile` -- stop and write trace files
- Server must be started with profiler config:
  `--profiler-config '{"profiler": "torch", "torch_profiler_dir": "<dir>"}'`

**Collection sequence**:
```bash
PROFILE_DIR="/tmp/vllm_profile_${CURRENT_TAG}"

# 1. Check profiler endpoint
TEST_CODE=$($SSH "curl -s -o /dev/null -w '%{http_code}' -X POST http://$SVC_URL/start_profile")
if [ "$TEST_CODE" != "200" ]; then
  echo "[ABORT] Profiler endpoint not available (HTTP $TEST_CODE)"
  echo "Server needs: --profiler-config '{\"profiler\": \"torch\", \"torch_profiler_dir\": \"$PROFILE_DIR\"}'"
  # Skip this mode
fi

# 2. Send requests under profiler (use curl, NOT vllm bench serve)
# vllm bench serve has tokenizer init delay that wastes profiler window
for i in $(seq 1 10); do
  $SSH "curl -sf http://$SVC_URL/v1/completions \
    -H 'Content-Type: application/json' \
    -d '{\"model\": \"$MODEL_NAME\", \"prompt\": \"Explain the concept of\", \"max_tokens\": 64, \"temperature\": 0}'" > /dev/null
done

# 3. Stop profiler
$SSH "curl -sf -X POST http://$SVC_URL/stop_profile"
sleep 3
```

**Trace files generated**:
- `rank0.*.pt.trace.json.gz` -- EngineCore trace (main GPU timeline)
- `*.async_llm.*.pt.trace.json.gz` -- API server trace
- `profiler_out_0.txt` -- kernel time summary (`key_averages()`)

**Kernel breakdown** from `profiler_out_0.txt`:
```bash
PROFILER_TXT=$($SSH "ls $PROFILE_DIR/profiler_out_*.txt 2>/dev/null | head -1")
$SSH "head -50 $PROFILER_TXT"
```

Classify top kernels into 9 categories:
| Category | Pattern matches |
|---|---|
| gemm | `aten::mm`, `cublas`, `cutlass`, matmul |
| attention | `flash_fwd`, `flash_bwd`, `fmha` |
| norm | `rmsnorm`, `layernorm`, `fused_*_norm` |
| activation | `silu`, `gelu`, `mul_silu` |
| rope | `rotary_embedding` |
| cache | `reshape_and_cache` |
| sampling | `topk_topp`, `SoftMaxForward`, `argmax` |
| memory | `Memcpy`, `Memset` |
| other | everything else |

Transfer traces:
```bash
mkdir -p "$BENCH_OUTPUT_DIR/profile-${CURRENT_TAG}"
scp "$SSH:$PROFILE_DIR/*" "$BENCH_OUTPUT_DIR/profile-${CURRENT_TAG}/"
```

Report:
```
Profile Analysis: $CURRENT_TAG
  Top Kernels (Self CUDA %):
    1. <kernel> -- <pct>% (<category>)
    ...
  Category Breakdown:
    | Category  | Self CUDA % |
    |-----------|-------------|
    | gemm      | XX%         |
    | attention | XX%         |
    ...
  Trace: bench-results/profile-${CURRENT_TAG}/ (open in https://ui.perfetto.dev)
```
</step>

<step name="KERNEL" condition="--kernel or --full">
Nsight Systems GPU kernel profiling and classification.

**Nsight collection commands**:
```bash
NSYS_PATH=$($SSH "which nsys 2>/dev/null || ls /usr/local/cuda*/bin/nsys 2>/dev/null | tail -1")
NSYS_OUTPUT="/tmp/vllm_nsys_${CURRENT_TAG}"

# Collect trace using vllm bench latency (offline, no server needed)
$SSH "CUDA_VISIBLE_DEVICES=0 $NSYS_PATH profile \
  -t cuda \
  -o $NSYS_OUTPUT \
  -f true \
  vllm bench latency \
    --model $MODEL_NAME \
    --batch-size 1 \
    --input-len 128 \
    --output-len 32 \
    --num-iters 3 \
    --enforce-eager \
    --load-format dummy"
```

Key flags:
- `--enforce-eager`: disable CUDA graph so individual kernels are visible
- `--load-format dummy`: skip weight download (random weights, fine for kernel profiling)
- `-t cuda`: trace only CUDA API and kernels (minimal overhead)

**Analysis commands**:
```bash
# Extract kernel summary CSV
KERNEL_CSV=$($SSH "$NSYS_PATH stats ${NSYS_OUTPUT}.nsys-rep \
  --report cuda_gpu_kern_sum \
  --format csv 2>&1 | grep -v '^Processing\|^NOTICE\|^Generating\|^$'")
```

CSV columns: Time(%), Total Time(ns), Instances, Avg(ns), Med(ns), Min(ns), Max(ns), StdDev(ns), Name

**Classify kernels** into 9 categories (same as PROFILE step).
Aggregate per category: sum Time(%) and instance count.
Flag any category >40% as dominant hotspot.

**Hotspot detection**:
- Single kernel >15% of total GPU time -- primary optimization target
- Category >40% -- architectural bottleneck
- Memory operations >10% -- data movement overhead, consider fusion

Transfer:
```bash
mkdir -p "$BENCH_OUTPUT_DIR/nsys-${CURRENT_TAG}"
scp "$SSH:${NSYS_OUTPUT}.nsys-rep" "$BENCH_OUTPUT_DIR/nsys-${CURRENT_TAG}/"
echo "$KERNEL_CSV" > "$BENCH_OUTPUT_DIR/nsys-${CURRENT_TAG}/kernel_summary.csv"
```

Report:
```
Kernel Analysis: $CURRENT_TAG
  GPU Time Breakdown:
    | Category  | Time %  | Instances | Top kernel              |
    |-----------|---------|-----------|-------------------------|
    | gemm      | XX.X%   | NNNN      | ampere_bf16_gemm...     |
    | attention | XX.X%   | NNNN      | flash_fwd_splitkv...    |
    ...
  Hotspot: <category> at XX% (if >40%)
  Saved: bench-results/nsys-${CURRENT_TAG}/
```
</step>

<step name="CROSS_ANALYSIS" condition="--full">
Cross-correlation analysis combining all mode results.

If bench AND profile both ran:
- TTFT regressed + attention overhead increased: "TTFT regression correlates with attention overhead"
- TPOT regressed + gemm time increased: "TPOT regression correlates with linear layer slowdown"

If bench AND kernel both ran:
- Throughput dropped + gemm dominance increased: "Throughput drop correlates with GEMM bottleneck"
- Latency increased + memory operations grew: "Latency may relate to data movement overhead"

If regression detected but kernel distribution unchanged:
- "Suspect scheduling, memory pressure, or external interference"

Generate report: `bench-results/vllm-opt-report-${CURRENT_TAG}.md`

Checkpoint:
```bash
node "$DEVFLOW_BIN" checkpoint \
  --action "vllm-opt" \
  --summary "vLLM optimization: $CURRENT_TAG ($MODE)"
```
</step>
</process>

<anti_rationalization>

## Anti-Rationalization Table

| Temptation | Reality Check |
|---|---|
| "The benchmark is good enough" | 3x median with temperature=0 or it's noise. One run proves nothing. |
| "I'll optimize this kernel" | Profile first. The bottleneck is rarely where you think. |
| "Profiling overhead doesn't matter" | 10-30% overhead. Never compare profiled vs non-profiled latency. |
| "CUDA graphs hide everything" | Use --enforce-eager for kernel visibility. Graph analysis is separate. |
| "The GPU is saturated" | Check nvidia-smi. Stale processes, thermal throttling, memory fragmentation. |
| "It's faster on my machine" | Same model, same batch size, same input length, same GPU. Apples to apples. |

## Red Flags

- Comparing results across different GPU types or driver versions
- Single benchmark run used for decisions (need 3x minimum)
- Profiling with CUDA graphs enabled (kernels merged, invisible)
- Benchmarking with temperature > 0 (non-deterministic output lengths)
- Optimizing without a baseline measurement

## Verification Checklist

- [ ] GPU environment clean (no stale processes, memory clear)
- [ ] Benchmark run 3x, median of medians used
- [ ] Temperature=0 for deterministic output lengths
- [ ] Previous tag results available for comparison
- [ ] Regression threshold checked ($REGRESSION_THRESHOLD%)
- [ ] Traces transferred to local bench-results/

</anti_rationalization>
