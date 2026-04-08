# devflow

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code Plugin](https://img.shields.io/badge/Claude_Code-Plugin-blueviolet)](https://claude.ai/claude-code)
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-green)](https://nodejs.org)

A Claude Code plugin for managing development lifecycles — structured coding, container build, K8s deploy, testing, and debug — all from slash commands.

## Why devflow

Most AI coding tools handle single files. Real projects span multiple repos, need container builds, cluster deployments, and post-deploy verification. devflow bridges that gap with a **6-stage pipeline** and a routing flowchart that auto-selects the right step:

```
DEFINE  →  PLAN  →  CODE  →  VERIFY  →  REVIEW  →  SHIP
/spec      /plan    /code    /test      /review    /ship
```

No manual pipeline selection needed — devflow's meta-skill routes to the right stage based on project state, or you can invoke any stage directly.

## Quick Start

```bash
# Install from marketplace
claude plugin marketplace add wz1qqx/devflow-plugin
claude plugin install devflow@devflow

# In your project directory
/devflow init                        # Initialize workspace (.dev.yaml)
/devflow init feature my-feature     # Create a feature
/devflow next                        # Auto-detect state, suggest next step
```

## Commands

### Pipeline (6 stages)

| Command | Stage | Description |
|---------|-------|-------------|
| `/devflow spec` | DEFINE | Surface gray areas, lock decisions, generate structured spec |
| `/devflow plan` | PLAN | Read-only analysis → dependency graph → vertical slices |
| `/devflow code` | CODE | RED → GREEN → REFACTOR → Commit with wave parallelism |
| `/devflow test` | VERIFY | Unit / integration / e2e tests, Prove-It pattern for bugs |
| `/devflow review` | REVIEW | Five-axis review: correctness, readability, architecture, security, performance |
| `/devflow ship` | SHIP | Strategy-driven shipping (docker / k8s / ci-cd) with rollback |

### Independent Skills

| Command | Description |
|---------|-------------|
| `/devflow quick` | Ad-hoc task with atomic commits — skip full pipeline |
| `/devflow debug` | Structured investigation: reproduce → localize → fix → guard |
| `/devflow vllm-opt` | vLLM performance: torch profiler, nsight kernels, benchmarks |
| `/devflow grafana-setup` | Deploy Grafana monitoring stack in a k8s cluster |
| `/devflow learn` | Research a topic and create/update interlinked wiki pages |
| `/devflow code-simplify` | Reduce complexity while preserving exact behavior |

### Project Management

| Command | Description |
|---------|-------------|
| `/devflow init` | Initialize workspace or create a new feature |
| `/devflow status` | Project overview — config, worktrees, deployments, pipeline stage |
| `/devflow diff` | Show worktree changes across repositories |
| `/devflow switch` | Switch active feature context |
| `/devflow cluster` | Manage K8s cluster profiles (add / use / list) |
| `/devflow clean` | Clean orphan worktrees, stale images, K8s resources |

### Knowledge & Session

| Command | Description |
|---------|-------------|
| `/devflow knowledge` | Wiki operations — search, lint, list |
| `/devflow log` | Quick checkpoint — save progress snapshot to devlog |
| `/devflow pause` | Save session state (HANDOFF.json + STATE.md) |
| `/devflow resume` | Restore session state and continue where you left off |
| `/devflow next` | Auto-detect project state and suggest the next step |

## Architecture

```
User → Command (.md) → Skill (.md) → Agent (.md) + CLI (.cjs)
       Entry Layer      Process        Execution     State Layer
```

**Commands** (`commands/devflow/`) — thin entry points generated from `_registry.yaml`. Each references a skill file and loads context via CLI.

**Skills** (`skills/my-dev/`) — flat directory of self-contained process files. Each skill defines steps, checkpoints, anti-rationalization tables, and verification gates.

**Agents** (`skills/my-dev/agents/`) — specialized AI agents spawned by skills for isolated sub-tasks.

**CLI** (`skills/my-dev/bin/`) — minimal Node.js tools for state management, config loading, and checkpoints.

### Skill Anatomy

Every skill follows a consistent structure:

```
# Skill: <name> (<PHASE>)

<purpose>             → What the skill does
<core_principle>      → Non-negotiable rule

<process>
  <step name="INIT">  → CLI context loading
  <step name="...">   → Concrete steps with bash code blocks
  <step name="SAVE">  → Persist artifacts + state update + checkpoint
</process>

<anti_rationalization>
  | Excuse | Reality |  → Prevents the agent from cutting corners
  Red Flags:            → Warning signs
  Verification:         → Concrete evidence required
</anti_rationalization>
```

### Meta-Skill Routing

`SKILL.md` is loaded at session start and contains a decision tree that routes tasks to the correct skill:

```
Task arrives
    ├── Trivial fix? ──────────→ /quick
    ├── Need clarity? ─────────→ /spec
    ├── Have spec, need plan? ─→ /plan
    ├── Implementing code? ────→ /code
    ├── Need to test? ─────────→ /test
    ├── Code to review? ───────→ /review
    ├── Ready to ship? ────────→ /ship
    ├── Something broke? ──────→ /debug
    └── vLLM performance? ─────→ /vllm-opt
```

### Agents

Five specialized agents, each scoped to a role with minimal tool access:

| Agent | Role |
|-------|------|
| `my-dev-planner` | Wave-grouped task planning with built-in verification |
| `my-dev-executor` | Code implementation, atomic commits |
| `my-dev-reviewer` | Five-axis code review (read-only) |
| `my-dev-researcher` | Codebase exploration + wiki loading (read-only) |
| `my-dev-debugger` | Hypothesis → Action → Result → Lesson cycle |

### Directory Layout

```
devflow-plugin/
├── commands/devflow/           # 23 slash commands (1 hand-maintained + 22 generated)
│   └── _registry.yaml          # Source of truth
├── skills/my-dev/
│   ├── SKILL.md                # Meta-skill: routing + core behaviors
│   ├── spec.md ... ship.md     # 6 pipeline stages
│   ├── debug.md ... resume.md  # 11 independent skills & utilities
│   ├── agents/                 # 5 agent definitions
│   ├── references/             # 4 shared reference docs
│   └── bin/                    # CLI tools (7 modules)
└── bin/generate-commands.cjs   # Command code generator
```

## Configuration

Create `.dev.yaml` in your project root (or let `/devflow init` generate it):

```yaml
schema_version: 2

workspace: ~/my-project
vault: ~/Obsidian/MyVault              # Optional: wiki knowledge persistence

repos:
  my-repo:
    upstream: https://github.com/org/repo
    baselines:
      v1.0: my-repo-v1.0              # worktree directory name

build_server:
  ssh: user@build-server
  work_dir: /data/builds
  registry: registry.example.com

clusters:
  dev-cluster:
    ssh: user@jump-server
    namespace: my-namespace
    safety: normal                     # normal | prod (requires confirmation)
    hardware:
      gpu: "8x A100"

defaults:
  active_feature: my-feature
  active_cluster: dev-cluster

features:
  my-feature:
    description: "My awesome feature"
    phase: spec                        # spec|plan|code|test|review|ship|debug|dev|completed
    scope:
      my-repo:
        base_ref: v1.0
        dev_worktree: my-repo-dev
    invariants:
      source_restriction: dev_worktree_only
    ship:
      strategy: k8s                    # docker | k8s | ci-cd
```

See [`skills/my-dev/references/schema.md`](skills/my-dev/references/schema.md) for the complete schema reference.

## Key Concepts

### 6-Stage Pipeline

Each stage has an anti-rationalization table (common excuses vs reality), red flags, and concrete verification requirements. The agent cannot self-certify — evidence is required at every gate.

### Strategy-Driven Shipping

`/devflow ship` reads `ship.strategy` from `.dev.yaml` and routes to the appropriate flow:
- **docker** — build image → push → update tag
- **k8s** — build + deploy to cluster → wait ready → health check
- **ci-cd** — trigger CI pipeline → wait → verify

Rollback is built into the ship skill, not a separate command.

### Wave-Based Parallel Execution

The planner groups independent tasks into waves. Tasks within a wave execute as parallel subagents, each producing atomic git commits. Dependencies between waves are respected sequentially.

### Namespace Safety

All `kubectl` commands are enforced with `-n <namespace>`. Production clusters (`safety: prod`) require explicit confirmation before any destructive operation.

### Three-Tier Knowledge

1. **Wiki Index** (`wiki/index.md`) — always loaded, content catalog
2. **Wiki Pages** (`wiki/` + `experience/`) — loaded on demand via semantic matching
3. **Archive** (`devlog/`, `archive/`) — search only, never loaded into context

### Session Handoff

`/devflow pause` captures uncommitted files, plan progress, and context notes into `HANDOFF.json` + `STATE.md`. `/devflow resume` restores everything — zero-loss across sessions.

### Phase Migration

Projects using older phase values (init, discuss, exec, deploy, verify, observe) are automatically migrated to the new pipeline phases on first access.

## Prerequisites

**Required:**
- **Node.js** >= 18

**Optional (for specific workflows):**
- **jq** — JSON processing in skill steps
- **kubectl** — K8s operations (ship, cluster, clean)
- **ssh** — remote build server and cluster access

## Local Development

```bash
git clone https://github.com/wz1qqx/devflow-plugin.git ~/devflow-plugin
bash ~/devflow-plugin/bin/setup.sh
```

After cloning, run `/devflow-setup` in Claude Code to verify the installation.

## License

MIT
