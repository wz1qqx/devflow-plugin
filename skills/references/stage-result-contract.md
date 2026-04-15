# Stage Result Contract

This repository is prompt-first, so stage handoff semantics must be explicit.
Every stage agent returns two things in a single final message:

1. A human-readable report for the orchestrator and the user.
2. A final fenced `json` block under `## STAGE_RESULT` for machine parsing.

The JSON block is the workflow contract. The orchestrator uses it to decide whether to:
- checkpoint the stage
- trigger a review fix loop
- trigger an optimization loop
- retry or escalate to the user
- persist stage artifacts to feature-scoped files

## Required Format

The final message MUST end with:

````markdown
<human-readable report>

## STAGE_RESULT
```json
{
  "stage": "<spec|plan|code|review|build|ship|verify|vllm-opt>",
  "status": "completed|failed|needs_input",
  "verdict": "PASS|PASS_WITH_WARNINGS|FAIL|NEEDS_INPUT",
  "artifacts": [],
  "next_action": "<single next step for orchestrator>",
  "retryable": false,
  "metrics": {}
}
```
````

Do not place any prose after the JSON block.

## Field Semantics

| Field | Type | Meaning |
|---|---|---|
| `stage` | string | Fixed stage identifier for the emitting agent |
| `status` | string | Agent execution outcome: `completed`, `failed`, or `needs_input` |
| `verdict` | string | Stage/business result. Example: reviewer can return `completed + FAIL` |
| `artifacts` | array | Files, tags, commits, or deployment refs produced by the stage |
| `next_action` | string | Single imperative sentence describing what the orchestrator should do next |
| `retryable` | boolean | Whether the orchestrator may auto-retry or offer retry first |
| `metrics` | object | Stage-specific structured data. Use `{}` if none |

## Artifact Objects

Each artifact entry should include `kind`, plus whichever fields are relevant:

```json
{
  "kind": "spec|plan|commit|review|image|deploy|benchmark|guidance",
  "path": ".dev/features/<feature>/<file>.md",
  "tag": "registry/app:0415-fastpath",
  "ref": "deployment/vllm",
  "repo": "repo-name",
  "commit": "abc1234",
  "notes": "optional detail"
}
```

## Optional Fields

These fields are optional but recommended when relevant:

```json
{
  "remediation_items": ["specific fix item"],
  "blocking_reason": "why the stage could not proceed"
}
```

Use `remediation_items` when the next stage depends on concrete follow-up work:
- reviewer FAIL
- coder partial completion or blocked execution
- verifier FAIL with clear fix targets

## Status vs Verdict

This distinction is mandatory:

- `status: "completed"` + `verdict: "FAIL"` means the agent finished and found a business failure.
  Example: reviewer completed the review and found blocking defects.
- `status: "failed"` + `verdict: "FAIL"` means the agent itself could not execute correctly.
  Example: build command crashed before producing an image.
- `status: "needs_input"` + `verdict: "NEEDS_INPUT"` means human direction is required.

This is what lets the orchestrator distinguish:
- retryable execution problems
- legitimate FAIL verdicts that should trigger loops
- user-decision branches

## Stage-Specific Expectations

| Stage | Required artifact/metric shape |
|---|---|
| `spec` | artifact path to `spec.md`; metrics should include decisions locked and verification criteria count |
| `plan` | artifact path to `plan.md`; metrics should include task count, wave count, build mode |
| `code` | commit artifacts; metrics should include tasks completed and commit count |
| `review` | review report before JSON; review artifact path; metrics should include finding counts; `remediation_items` required on FAIL |
| `build` | image artifact with tag; build-manifest artifact path; metrics should include build mode and build duration if known |
| `ship` | deployment artifact/ref; metrics should include readiness and health check results |
| `verify` | benchmark/report artifacts; metrics should include smoke counts, threshold, and regressions array |
| `vllm-opt` | guidance report before JSON; guidance artifact path if persisted; metrics should include primary bottleneck and category breakdown |

## Ownership Boundary

Agents own:
- analysis
- implementation
- report generation
- feature artifacts directly related to their stage

The orchestrator owns:
- checkpoint writes
- `feature_stage` / `completed_stages` updates
- loop control
- user confirmations
- persistence of shared review/verify/optimization reports

## Normalized Decision Payload (orchestration helper output)

`node "$DEVTEAM_BIN" orchestration resolve-stage ...` returns a `decision` object with a stable shape.
Prompt-layer branching should use this payload only (not stage-specific prose parsing).

Required decision fields:

| Field | Meaning |
|---|---|
| `decision` | One of: `accept`, `review_fix_loop`, `optimization_loop`, `retry`, `needs_input` |
| `reason` | Deterministic machine-generated reason for the branch |
| `needs_user_input` | Whether orchestrator must ask the user before proceeding |
| `retryable` | Whether retry path is valid |
| `next_action` | Stage-provided imperative next step |
| `user_prompt` | Suggested prompt text for user input branches |
| `loop_context` | Structured loop metadata (review/optimization) or `null` |
| `remediation_items` | Normalized list of fix items (possibly empty) |
| `regressions` | Normalized regression list (possibly empty) |

Compatibility fields (still emitted):
- `should_accept`
- `should_checkpoint`
- `review_cycle`
- `max_review_cycles`
- `remaining_review_cycles`
