---
name: devflow
description: >
  /devflow — Universal Development Lifecycle Management. 管理多仓库开发生命周期：
  结构化编码(spec/plan/exec/review)、worktree 管理、镜像构建、K8s 部署、
  benchmark 验证、Grafana 可观测性、debug 调查、知识库集成。
  当用户提到构建镜像、部署、benchmark、dev worktree、项目状态、debug 调查、
  知识库覆盖、checkpoint、回滚部署、查看改动 diff、清理资源、结构化开发、
  feature spec、代码审查、监控面板、性能分析等任何开发运维操作时，使用此 skill。
  即使用户没有明确说 "/devflow"，只要涉及项目的
  code/build/deploy/verify/observe/rollback/diff/clean 流程，也应该主动建议使用。
---

# /devflow — Universal Development Lifecycle Management

4-layer architecture for full development lifecycle management.

## Architecture

```
用户 → Command (.md) → Workflow (.md) → Agent (.md) + CLI Tools (.cjs)
         入口层           编排层           执行层        状态层
```

**Config**: `.dev.yaml` (workspace root, schema v2)
**Schema**: [schema.md](./references/schema.md)
**Vault**: Configured in `.dev.yaml` `vault` field (optional)

### Workspace vs Feature 模型
```
Workspace (固定，一个 .dev.yaml)
  ├── Repos: dynamo, vllm, pegaflow (共享 repo 集合 + baselines)
  ├── Infra: build_server, clusters (共享基础设施)
  │
  ├── Feature A: decode-l2-cache  scope: [dynamo, vllm]    phase: dev
  ├── Feature B: pegaflow-connector  scope: [全部]          phase: verify
  ├── Feature C: scheduler-fix  scope: [vllm]              phase: completed
  └── Feature D: nixl-perf  scope: [dynamo]                phase: spec
```
一个 workspace 下多个 feature 并存，各自独立的 dev_worktrees 和 phase。

## Commands (Layer 1 — Entry Points)

Each action has a dedicated command at `~/.claude/commands/devflow/<action>.md`.
Invoke via `/devflow:<action>` or parse from `$ARGUMENTS` when called as `/devflow <action>`.

| Command | Description | Workflow |
|---------|-------------|----------|
| `/devflow:next` | Auto-detect state, suggest next step | [next.md](./workflows/next.md) |
| `/devflow:quick` | Ad-hoc task with atomic commits (skip ceremony) | [quick.md](./workflows/quick.md) |
| `/devflow:init` | `workspace`: 初始化 repo 集合 + 基础设施; `feature <name>`: 创建新 feature | [init.md](./workflows/init.md) / [init-feature.md](./workflows/init-feature.md) |
| `/devflow:resume` | Restore session, show status, suggest next step | [resume.md](./workflows/resume.md) |
| `/devflow:pause` | Save session state for later resume | [pause.md](./workflows/pause.md) |
| `/devflow:discuss` | Lock decisions before planning (gray areas) | [discuss.md](./workflows/discuss.md) |
| `/devflow:code` | Structured coding: auto-select pipeline depth | [code-*.md](./workflows/) |
| `/devflow:build` | Build container image with incremental tag chain | [build.md](./workflows/build.md) |
| `/devflow:deploy` | Deploy to K8s cluster | [deploy.md](./workflows/deploy.md) |
| `/devflow:verify` | Post-deploy verification + benchmark + accuracy | [verify.md](./workflows/verify.md) |
| `/devflow:observe` | Grafana dashboards, monitoring, metrics analysis | [observe.md](./workflows/observe.md) |
| `/devflow:debug` | Investigation mode + learned hook evolution | [debug.md](./workflows/debug.md) |
| `/devflow:diff` | Show dev_worktree vs base_ref changes | [info.md](./workflows/info.md) |
| `/devflow:rollback` | Deploy rollback to previous tag | [rollback.md](./workflows/rollback.md) |
| `/devflow:switch` | Switch active feature | workflow inline |
| `/devflow:clean` | Clean up unused resources | [clean.md](./workflows/clean.md) |
| `/devflow:log` | Quick checkpoint entry | workflow inline |
| `/devflow:status` | Full project status overview | [info.md](./workflows/info.md) |
| `/devflow:cluster` | Manage cluster profiles | workflow inline |
| `/devflow:knowledge` | Knowledge base operations | [knowledge-maintain.md](./workflows/knowledge-maintain.md) |
| `/devflow:learn` | Deep-dive learning (→ Obsidian knowledge) | [learn.md](./workflows/learn.md) |

## Dispatch Rule

When invoked as `/devflow <action> [args]`:
1. Parse first token of `$ARGUMENTS` as `<action>`
2. Route to the corresponding `/devflow:<action>` command
3. Pass remaining args to the command

## Complexity Tiering

`/devflow:code` auto-classifies task complexity and selects pipeline depth:

| Size | Pipeline | Trigger |
|------|----------|---------|
| `quick` | exec → commit | Prefixes: `quick:`, `just:`, `typo:` or ≤20 words with small signals |
| `small` | plan → exec → review | 1-3 files, <100 lines, small signals |
| `medium` | spec → plan → exec → review | Default for most tasks |
| `large` | discuss → spec → plan → exec → review | `refactor`, `architect`, `migrate`, cross-repo, >150 words |

Override with explicit flags: `--spec`, `--plan`, `--exec`, `--review`.

## Composable Behavior Layers

`/devflow:code <feature> --exec` supports stackable behavior flags:

| Flag | Layer | Effect |
|------|-------|--------|
| `--verify` | Enhancement | Smoke test (lint/test) after each wave |
| `--review-each` | Enhancement | Mini code review after each task |
| `--persistent` | Guarantee | Auto-retry on failure, no user prompt (up to max_task_retries) |
| `--sequential` | Execution | Disable wave parallelism, run all tasks serially |

Flags compose freely: `--exec --persistent --verify --review-each`

## Specificity Gate

Build and deploy workflows check if the request is specific enough:
- Vague requests ("部署一下") → redirect to discuss/planning
- Specific requests (with file paths, tags, cluster names) → execute directly
- `--force` bypasses the gate

## Workflows (Layer 2 — Orchestration)

Located at `./workflows/` (within the plugin). Orchestrators stay lean:
- Load context via `my-dev-tools.cjs init <workflow>`
- Spawn specialized agents with fresh context windows
- Collect results and route to next step
- Update state between steps

### Code Sub-Workflows (core innovation)
| Workflow | Purpose | Agents Used |
|----------|---------|-------------|
| `code-spec.md` | Generate feature specification | my-dev-researcher |
| `code-plan.md` | Create implementation plan + verification loop | my-dev-planner, my-dev-plan-checker |
| `code-exec.md` | Wave-based parallel execution + composable behaviors | my-dev-executor (per plan) |
| `code-review.md` | Automated code review | my-dev-reviewer |

## Agents (Layer 3 — Execution)

Built-in agents at `./agents/` (within the plugin). Add custom agents to `.devflow/agents/` (project-local, higher priority).

| Agent | Role | Tools | Model (balanced) |
|-------|------|-------|-----------------|
| `my-dev-researcher` | Code exploration, knowledge loading | Read, Bash, Grep, Glob, WebSearch | haiku |
| `my-dev-planner` | Plan generation, wave analysis | Read, Write, Bash, Glob, Grep | opus |
| `my-dev-plan-checker` | Plan verification (read-only) | Read, Bash, Glob, Grep | sonnet |
| `my-dev-executor` | Code implementation, atomic commits | Read, Write, Edit, Bash, Grep, Glob | sonnet |
| `my-dev-reviewer` | Code review (read-only) | Read, Bash, Grep, Glob | sonnet |
| `my-dev-verifier` | Post-deploy system verification | Read, Write, Bash, Grep, Glob | sonnet |
| `my-dev-debugger` | Investigation + hypothesis tracking | Read, Write, Edit, Bash, Grep, Glob, WebSearch | sonnet |

Model routing controlled by `defaults.model_profile` (quality/balanced/budget). Per-agent override via `defaults.agent_models`.

## CLI Tools (Layer 4 — State Management)

Located at `./bin/my-dev-tools.cjs` (auto-discovered at runtime).

```bash
# Context loading (returns JSON with all workflow context)
node "$DEVFLOW_BIN" init <workflow> [args]

# Config operations
node "$DEVFLOW_BIN" config load
node "$DEVFLOW_BIN" config get <key>

# State operations
node "$DEVFLOW_BIN" state get [field]
node "$DEVFLOW_BIN" state update <field> <value>

# Model resolution (profile-driven: quality/balanced/budget)
node "$DEVFLOW_BIN" resolve-model <agent-name>

# Task complexity classification
node "$DEVFLOW_BIN" classify <prompt>

# Prompt specificity check
node "$DEVFLOW_BIN" check-specificity <prompt>

# Agent discovery (plugin + project .devflow/agents/)
node "$DEVFLOW_BIN" agents list

# Feature management
node "$DEVFLOW_BIN" features list|active|switch

# Template operations
node "$DEVFLOW_BIN" template fill <type> [--vars]

# Verification
node "$DEVFLOW_BIN" verify plan-structure <file>
node "$DEVFLOW_BIN" verify phase-completeness <feature>

# Checkpoint
node "$DEVFLOW_BIN" checkpoint --action <action> --summary <text>
```

## Memory System

See [memory-system.md](./references/memory-system.md) for full specification.

### Memory Architecture (4 layers)

```
Obsidian Vault (永久记忆 · 第二大脑) [OPTIONAL]
  knowledge/    ← learn 产出 + review 沉淀
  experience/   ← debug 经验提炼 + 踩坑教训
  devlog/       ← checkpoint + investigation
       ↑ 沉淀          ↓ 加载
.dev/ (工作记忆 · session/feature 级)
  STATE.md      ← position, decisions[], blockers[], metrics
  HANDOFF.json  ← 会话交接 (pause → resume)
  features/<feature>/
    spec.md, context.md, research.md, plan.md, review.md, summary.md
       ↑ 读取
.dev.yaml (项目配置)  |  hooks/ (行为记忆)
```

### Knowledge Sink Rules
- `learn` → Obsidian `knowledge/<feature>.md` (if vault configured)
- `debug` resolution → Obsidian `experience/<topic>-patterns.md` + learned hook (if vault configured)
- `code --review` patterns → Obsidian `knowledge/<pattern>.md` (if vault configured)
- If no Obsidian vault configured, knowledge stays in `.dev/features/` only

## Hooks

| Hook | File | Event | Purpose |
|------|------|-------|---------|
| Context Monitor | `my-dev-context-monitor.js` | PostToolUse | Warn at 35%/25% remaining context |
| Persistent Mode | `devflow-persistent.js` | Stop | Re-inject continuation when `--persistent` active |

## Shared Resources

| Path | Contents |
|------|----------|
| `./references/` (within the plugin) | schema.md, hooks.md, model-profiles.md, memory-system.md |
| `./templates/` (within the plugin) | spec.md, plan.md, review.md, summary.md, state.md, context.md, experience.md |
| `.dev.yaml` | Project config (workspace root) |
| `.dev/` | Working memory: STATE.md, HANDOFF.json, features/ |
| `.devflow/agents/` | Project-local custom agent definitions (optional) |
| Obsidian vault | Permanent knowledge + experience + devlog (optional) |

## Core Invariants

- **source_restriction: dev_worktree_only** → NEVER copy from main repo
- **build_compat_check** → patched files MUST be compatible with base_ref API
- **BASE_IMAGE = current_tag** (incremental chain), NOT the official base image
- **Namespace safety** → ALL kubectl commands include `-n <namespace>`
- **Knowledge sink** → debug/review 中发现的知识沉淀到 Obsidian (if configured)

## State Machine

```
init → learn → code(spec→discuss→plan→exec→review) → build → deploy → verify → observe → [debug] → code
                  ↑                                                                ↓
            Obsidian ←──────────────────── knowledge sink ←──────────────── experience sink
```

## Parameters

$ARGUMENTS - `<action> [args...]`
