# vLLM Benchmark Conventions

Reference for vLLM's benchmarking tools and devflow verify integration.

## Core CLI: `vllm bench serve`

Primary tool for online serving benchmark. Measures TTFT, TPOT, ITL, E2E latency, throughput.

Key flags:
- `--backend openai|openai-chat|vllm|tgi` — API backend
- `--base-url http://host:port` — server address
- `--model <name>` — model name (auto-detected from `/v1/models` if omitted)
- `--dataset-name random|sharegpt|sonnet|hf|custom` — workload source
- `--random-input-len N`, `--random-output-len N` — synthetic workload shape
- `--num-prompts N` — total requests to send
- `--request-rate N|inf` — requests per second (inf = send all at once)
- `--max-concurrency N` — max concurrent requests
- `--num-warmups N` — warmup requests (excluded from results)
- `--percentile-metrics ttft,tpot,itl,e2el` — which metrics to percentile
- `--metric-percentiles 50,90,99` — which percentiles
- `--save-result --result-dir DIR --result-filename FILE` — persist results
- `--profile` — trigger server-side profiling during benchmark

## Result JSON Format

Standard fields in saved result file:
```json
{
  "duration": 12.5,
  "completed": 100,
  "failed": 0,
  "total_input_tokens": 12800,
  "total_output_tokens": 6400,
  "request_throughput": 8.0,
  "output_throughput": 512.0,
  "mean_ttft_ms": 45.2,
  "median_ttft_ms": 42.1,
  "p99_ttft_ms": 98.3,
  "mean_tpot_ms": 12.1,
  "median_tpot_ms": 11.8,
  "p99_tpot_ms": 18.5,
  "mean_e2e_latency_ms": 850.2,
  "median_e2e_latency_ms": 820.0,
  "p99_e2e_latency_ms": 1200.5
}
```

## Parameter Sweep: `vllm bench sweep serve`

Sweep across serve and bench configurations with Cartesian product:
- `--serve-cmd 'vllm serve ...'` — base serve command
- `--bench-cmd 'vllm bench serve ...'` — base bench command
- `--serve-params params.json` — server parameter combinations (JSON)
- `--bench-params params.json` — bench parameter combinations (JSON)
- `--link-vars max_num_seqs=max_concurrency` — linked parameters
- `--num-runs 3` — repetitions per combination
- `--resume` — skip already-completed combinations
- `--output-dir DIR`, `--experiment-name NAME`

Output: per-run JSON + `summary.csv` + Pareto plot via `vllm bench sweep plot-pareto`.

## Best Practices

- **Deterministic**: Always use `temperature=0` for reproducible results
- **Stable baseline**: Same dataset, same seed, same hardware between comparisons
- **Warmup**: At least 3 warmup requests before measurement
- **Repetitions**: Run 3x and use median for stable comparison
- **Regression threshold**: Default 20% (configurable via `tuning.regression_threshold`)
- **Result naming**: `bench-results/mtb-{tag}-run{N}.txt` for traceability
- **Background execution**: Use `run_in_background=true` for benchmarks > 5 min

## CI Comparison Tool

vLLM provides `.buildkite/performance-benchmarks/scripts/compare-json-results.py`
for cross-run comparison. Calculates performance ratios and generates tables.
