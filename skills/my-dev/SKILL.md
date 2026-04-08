---
name: devflow
description: >
  Development lifecycle management with 6-stage pipeline (spec/plan/code/test/review/ship),
  plus independent skills (debug, vllm-opt, grafana-setup, learn, code-simplify).
  Trigger for: feature spec, task planning, code implementation, testing, code review,
  container build, deploy, rollback, debug, benchmark, worktree, project status,
  checkpoint, resume/pause session.
  Proactively suggest even without explicit "/devflow" — any development workflow
  in a .dev.yaml project should use this skill.
---

# /devflow — Development Lifecycle Management

6-stage pipeline with flat skill architecture. Each skill is a self-contained process.

## Skill Discovery

When a task arrives, route to the right skill:

```
Task arrives
    │
    ├── Trivial fix (typo, config tweak)? ───→ /quick
    ├── Need clarity on what to build? ──────→ /spec
    ├── Have spec, need implementation plan? ─→ /plan
    ├── Implementing code? ──────────────────→ /code
    ├── Need to verify/test? ────────────────→ /test
    ├── Code to review? ─────────────────────→ /review
    ├── Ready to build image / deploy? ──────→ /ship
    ├── Something broke? ────────────────────→ /debug
    ├── vLLM performance optimization? ──────→ /vllm-opt
    ├── Need Grafana monitoring? ────────────→ /grafana-setup
    ├── Research / wiki building? ───────────→ /learn
    ├── Simplify changed code? ──────────────→ /code-simplify
    ├── Save session for later? ─────────────→ /pause
    └── Restore previous session? ───────────→ /resume
```

## Pipeline

```
DEFINE  →  PLAN  →  CODE  →  VERIFY  →  REVIEW  →  SHIP
/spec      /plan    /code    /test      /review    /ship
```

| Phase | Command | Description |
|-------|---------|-------------|
| DEFINE | `spec` | Surface gray areas, lock decisions, generate structured spec |
| PLAN | `plan` | Read-only analysis → dependency graph → vertical slices |
| CODE | `code` | RED → GREEN → REFACTOR → Commit, wave parallelism |
| VERIFY | `test` | Unit / integration / e2e tests, smoke checks |
| REVIEW | `review` | Five-axis review: correctness, readability, architecture, security, performance |
| SHIP | `ship` | Strategy-driven shipping: docker, k8s, or ci-cd |

## Independent Skills

| Command | Description |
|---------|-------------|
| `quick` | Ad-hoc task with atomic commits — skip full pipeline |
| `debug` | Structured investigation: reproduce → localize → fix → guard |
| `vllm-opt` | vLLM performance: torch profiler, nsight kernels, benchmarks |
| `grafana-setup` | Deploy Grafana monitoring stack in k8s cluster |
| `learn` | Research topic and build/update wiki pages |
| `code-simplify` | Reduce complexity while preserving exact behavior |

## Utilities

| Command | Description |
|---------|-------------|
| `init` | Initialize workspace or add feature |
| `pause` / `resume` | Session save/restore |
| `status` / `diff` | Project overview / show changes |
| `next` | Auto-detect state, suggest next step |
| `switch` | Switch active feature |
| `clean` | Cleanup orphan resources |
| `cluster` | Manage k8s cluster profiles |
| `log` | Quick checkpoint |
| `knowledge` | Wiki search/lint/list |

## Dispatch Rule

When invoked as `/devflow <action> [args]`:
1. Parse first token of `$ARGUMENTS` as `<action>`
2. Route to the corresponding `/devflow:<action>` command
3. Pass remaining args to the command

## Core Operating Behaviors

These behaviors apply at all times, across all skills. They are non-negotiable.

### 1. Surface Assumptions

Before implementing anything non-trivial, explicitly state your assumptions:
```
ASSUMPTIONS I'M MAKING:
1. [assumption about requirements]
2. [assumption about architecture]
3. [assumption about scope]
→ Correct me now or I'll proceed with these.
```

### 2. Manage Confusion

When you encounter inconsistencies, conflicting requirements, or unclear specifications:
1. STOP. Do not proceed with a guess.
2. Name the specific confusion.
3. Present the tradeoff or ask the clarifying question.
4. Wait for resolution before continuing.

### 3. Push Back When Warranted

You are not a yes-machine. When an approach has clear problems:
- Point out the issue directly
- Explain the concrete downside
- Propose an alternative
- Accept the user's decision if they override with full information

### 4. Enforce Simplicity

Before finishing any implementation, ask:
- Can this be done in fewer lines?
- Are these abstractions earning their complexity?
- Three similar lines of code is better than a premature abstraction.

### 5. Scope Discipline

Do NOT:
- Remove comments you don't understand
- "Clean up" code orthogonal to the task
- Refactor adjacent systems as a side effect
- Delete code that seems unused without explicit approval
- Add features not in the spec

### 6. Verify, Don't Assume

Every skill includes a verification step. A task is not complete until verification passes. "Seems right" is never done.

## Anti-Rationalization

Every pipeline stage includes an anti-rationalization table to prevent the agent from cutting corners:

| Rationalization | Reality |
|---|---|
| *common excuse* | *why it's wrong and what to do instead* |

**Red Flags**: signs the agent is skipping steps or making dangerous assumptions.

**Verification**: concrete evidence required at each gate — passing tests, build output, runtime data, user approval. Never self-certify.

## References

Architecture, agents, CLI tools, memory system → see `./references/`

## Parameters

$ARGUMENTS - `<action> [args...]`
