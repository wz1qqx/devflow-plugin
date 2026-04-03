# vLLM Profiling Conventions

Reference for vLLM's profiling tools and how devflow verify `--profile` uses them.

## Torch Profiler

### Server Configuration

The server must be started with `--profiler-config` for HTTP profile API:
```bash
vllm serve <model> --profiler-config '{"profiler": "torch", "torch_profiler_dir": "/tmp/vllm_profile"}'
```

Key config fields (JSON):
- `profiler`: `"torch"` or `"cuda"`
- `torch_profiler_dir`: directory for trace output
- `delay_iterations`: skip N steps before profiling
- `max_iterations`: max profiling steps
- `warmup_iterations`, `active_iterations`, `wait_iterations`: schedule control
- `torch_profiler_record_shapes`: record tensor shapes (default false)
- `torch_profiler_with_stack`: record Python stack (default false)
- `torch_profiler_use_gzip`: compress traces (default true)

### HTTP API

- `POST /start_profile` — begin trace collection (returns 200 on success)
- `POST /stop_profile` — stop and flush traces to `torch_profiler_dir`

If the server was NOT started with `--profiler-config`, these endpoints return 404.

### Output Files

After `/stop_profile`, the profiler generates:
- `rank0.<timestamp>.pt.trace.json.gz` — EngineCore GPU trace (main analysis target)
- `<hostname>_<pid>.async_llm.<timestamp>.pt.trace.json.gz` — API server trace
- `profiler_out_0.txt` — `key_averages().table()` kernel summary (text)

The `.trace.json.gz` files can be viewed at https://ui.perfetto.dev

### profiler_out_0.txt Format

The text summary contains per-kernel statistics:
```
Name | Self CPU % | Self CPU | CPU total % | CPU total | Self CUDA | Self CUDA % | CUDA total | # of Calls
```

Key columns for analysis:
- **Self CUDA %**: kernel's share of total GPU time
- **Self CUDA**: absolute GPU time
- **# of Calls**: invocation count

### Kernel Category Classification

For `--profile` mode, classify top kernels by name patterns:

| Category | Name patterns |
|----------|---------------|
| gemm | `aten::mm`, `cublas`, `cutlass`, `gemv`, matmul |
| attention | `flash_fwd`, `flash_bwd`, `fmha` |
| norm | `rmsnorm`, `layernorm`, `fused_*norm` |
| activation | `silu`, `gelu`, `mul_silu`, `act_and_mul` |
| cache | `reshape_and_cache`, `cache_kernel` |
| memory | `Memcpy`, `Memset`, `memcpy32_post` |
| triton | `triton_poi_fused_*`, `triton_per_fused_*`, `triton_red_fused_*` |
| other | everything else |

## Nsight Systems (Phase 4)

### Collection
```bash
nsys profile -t cuda --cuda-graph-trace=node -o output_name \
  vllm bench serve ...
```
Requires `nsys` installed on the target node.

### Analysis Tools (source repo only, not in pip install)
- `tools/profiler/nsys_profile_tools/gputrc2graph.py` — kernel classification + stacked bar chart
- `tools/profiler/nsys_profile_tools/vllm_engine_model.json` — classification rules
- `tools/profiler/visualize_layerwise_profile.py` — layerwise breakdown visualization
- `tools/profiler/print_layerwise_table.py` — text layerwise summary

Note: these tools live in the vLLM source tree (`tools/profiler/`), not in the pip package.
To use them, clone the vllm repo on the target machine or copy the scripts.

## Profiling Overhead

- Torch profiler: ~10-30% overhead (do NOT compare profiled vs non-profiled benchmarks)
- Nsight: ~5-15% overhead
- Always collect baseline timing without profiling first

## Best Practices

- Use small workloads for profiling (10-50 requests, not 1000)
- Use deterministic settings (`temperature=0`)
- Prefer `rank0` trace over merged traces for single-GPU analysis
- Compare same workload parameters across tags
- Profile after warmup (3+ requests) to capture steady-state behavior
