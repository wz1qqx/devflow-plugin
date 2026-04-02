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
**Schema**: [schema-v2.md](~/.claude/my-dev/references/schema-v2.md)
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
| `/devflow:next` | Auto-detect state, suggest next step | [next.md](~/.claude/my-dev/workflows/next.md) |
| `/devflow:quick` | Ad-hoc task with atomic commits (skip ceremony) | [quick.md](~/.claude/my-dev/workflows/quick.md) |
| `/devflow:init` | `workspace`: 初始化 repo 集合 + 基础设施; `feature <name>`: 创建新 feature | [init.md](~/.claude/my-dev/workflows/init.md) / [init-feature.md](~/.claude/my-dev/workflows/init-feature.md) |
| `/devflow:resume` | Restore session, show status, suggest next step | [resume.md](~/.claude/my-dev/workflows/resume.md) |
| `/devflow:pause` | Save session state for later resume | [pause.md](~/.claude/my-dev/workflows/pause.md) |
| `/devflow:discuss` | Lock decisions before planning (gray areas) | [discuss.md](~/.claude/my-dev/workflows/discuss.md) |
| `/devflow:code` | Structured coding: spec → plan → exec → review | [code-*.md](~/.claude/my-dev/workflows/) |
| `/devflow:build` | Build container image with incremental tag chain | [build.md](~/.claude/my-dev/workflows/build.md) |
| `/devflow:deploy` | Deploy to K8s cluster | [deploy.md](~/.claude/my-dev/workflows/deploy.md) |
| `/devflow:verify` | Post-deploy verification + benchmark + accuracy | [verify.md](~/.claude/my-dev/workflows/verify.md) |
| `/devflow:observe` | Grafana dashboards, monitoring, metrics analysis | [observe.md](~/.claude/my-dev/workflows/observe.md) |
| `/devflow:debug` | Investigation mode + learned hook evolution | [debug.md](~/.claude/my-dev/workflows/debug.md) |
| `/devflow:diff` | Show dev_worktree vs base_ref changes | [diff.md](~/.claude/my-dev/workflows/diff.md) |
| `/devflow:rollback` | Deploy rollback to previous tag | [rollback.md](~/.claude/my-dev/workflows/rollback.md) |
| `/devflow:switch` | Switch active project | workflow inline |
| `/devflow:clean` | Clean up unused resources | [clean.md](~/.claude/my-dev/workflows/clean.md) |
| `/devflow:log` | Quick checkpoint entry | workflow inline |
| `/devflow:status` | Full project status overview | [status.md](~/.claude/my-dev/workflows/status.md) |
| `/devflow:cluster` | Manage cluster profiles | workflow inline |
| `/devflow:knowledge` | Knowledge base operations | workflow inline |
| `/devflow:learn` | Deep-dive learning (→ Obsidian knowledge) | workflow inline |

## Dispatch Rule

When invoked as `/devflow <action> [args]`:
1. Parse first token of `$ARGUMENTS` as `<action>`
2. Route to the corresponding `/devflow:<action>` command
3. Pass remaining args to the command

## Workflows (Layer 2 — Orchestration)

Located at `~/.claude/my-dev/workflows/`. Orchestrators stay lean:
- Load context via `my-dev-tools.cjs init <workflow>`
- Spawn specialized agents with fresh context windows
- Collect results and route to next step
- Update state between steps

### Code Sub-Workflows (core innovation)
| Workflow | Purpose | Agents Used |
|----------|---------|-------------|
| `code-spec.md` | Generate feature specification | my-dev-researcher |
| `code-plan.md` | Create implementation plan + verification loop | my-dev-planner, my-dev-plan-checker |
| `code-exec.md` | Wave-based parallel execution | my-dev-executor (per plan) |
| `code-review.md` | Automated code review | my-dev-reviewer |

## Agents (Layer 3 — Execution)

Located at `~/.claude/my-dev/agents/`. Each has focused role + minimal tool permissions.

| Agent | Role | Tools | Model (balanced) |
|-------|------|-------|-----------------|
| `my-dev-researcher` | Code exploration, knowledge loading | Read, Bash, Grep, Glob, WebSearch | haiku |
| `my-dev-planner` | Plan generation, wave analysis | Read, Write, Bash, Glob, Grep | opus |
| `my-dev-plan-checker` | Plan verification (read-only) | Read, Bash, Glob, Grep | sonnet |
| `my-dev-executor` | Code implementation, atomic commits | Read, Write, Edit, Bash, Grep, Glob | sonnet |
| `my-dev-reviewer` | Code review (read-only) | Read, Bash, Grep, Glob | sonnet |
| `my-dev-verifier` | Post-deploy system verification | Read, Write, Bash, Grep, Glob | sonnet |
| `my-dev-debugger` | Investigation + hypothesis tracking | Read, Write, Edit, Bash, Grep, Glob, WebSearch | sonnet |

## CLI Tools (Layer 4 — State Management)

Located at `~/.claude/my-dev/bin/my-dev-tools.cjs`.

```bash
# Context loading (returns JSON with all workflow context)
node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init <workflow> [args]

# Config operations
node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" config load
node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" config get <key>

# State operations
node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" state get [field]
node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" state update <field> <value>

# Model resolution
node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" resolve-model <agent-name>

# Template operations
node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" template fill <type> [--vars]

# Verification
node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" verify plan-structure <file>
```

## Memory System

See [memory-system.md](~/.claude/my-dev/references/memory-system.md) for full specification.

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

## Shared Resources

| Path | Contents |
|------|----------|
| `~/.claude/my-dev/references/` | schema.md, hooks.md, model-profiles.md, memory-system.md |
| `~/.claude/my-dev/templates/` | spec.md, plan.md, review.md, summary.md, state.md, context.md, experience.md |
| `.dev.yaml` | Project config (workspace root) |
| `.dev/` | Working memory: STATE.md, HANDOFF.json, features/ |
| `hooks/` | Bash hook scripts (workspace root) |
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
