# devteam

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code Plugin](https://img.shields.io/badge/Claude_Code-Plugin-blueviolet)](https://claude.ai/claude-code)
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-green)](https://nodejs.org)
[![v2.1.0](https://img.shields.io/badge/version-2.1.0-orange)](https://github.com/wz1qqx/devteam)

Multi-agent pipeline orchestration for Claude Code. One command launches a team of specialized AI agents that take a feature from spec to verified deployment — with configurable stages, checkpoint resume, and automatic feedback loops.

## Why devteam

Most AI coding tools operate as a single agent on a single file. Real projects need requirements gathering, multi-file implementation, code review, container builds, cluster deployments, and post-deploy verification. devteam orchestrates **8 specialized agents** through a **configurable pipeline** with built-in feedback loops:

```
Spec → Plan → Code → Review → Build → Ship → Verify
                       ↑                        │
                       └── vLLM-Opter (on FAIL) ─┘
                           (optimization loop, max N iterations)
```

Pick the stages you need — run the full pipeline or just `--stages code,review` for a quick fix. Each agent is spawned with native `subagent_type` so tool restrictions are enforced by Claude Code (reviewer is truly read-only, coder has auto-approved edits). The orchestrator owns all user interaction and writes checkpoints between stages for interrupt recovery.

## Quick Start

```bash
# Install from marketplace
claude plugin marketplace add wz1qqx/devteam
claude plugin install devteam@devteam

# In your project directory
/devteam init workspace              # Initialize workspace (.dev.yaml)
/devteam init feature my-feature     # Create a feature

# Launch the full pipeline
/devteam team my-feature

# Or pick specific stages
/devteam team my-feature --stages code,review
/devteam team my-feature --stages plan,code,review,build,ship,verify
```

## The Agent Team

Eight specialized agents, each spawned with `subagent_type: "devteam:<name>"` for enforced tool scoping:

| Agent | Role | Tools | Permission |
|-------|------|-------|------------|
| **Spec** | Generate structured spec from orchestrator-collected requirements | Read, Write, Bash, Glob, Grep | default |
| **Planner** | Wave-grouped task plan with dependency graph, build mode detection | Read, Write, Bash, Glob, Grep | default |
| **Coder** | TDD implementation, one atomic `git commit` per task | Read, Write, Edit, Bash, Grep, Glob | acceptEdits |
| **Reviewer** | 5-axis review: correctness, readability, architecture, security, performance | Read, Bash, Grep, Glob | default (read-only) |
| **Builder** | Pre-ship checklist, incremental Docker tag chain, registry push | Read, Write, Bash, Glob, Grep | default |
| **Shipper** | GPU env check, namespace safety, kubectl deploy, health check | Read, Write, Bash, Glob, Grep | default |
| **Verifier** | Smoke tests (3/3 required), 3x benchmarks with loop, metric comparison | Read, Write, Bash, Glob, Grep | default |
| **vLLM-Opter** | Torch profiler + nsight kernel analysis, 9-category classification | Read, Write, Bash, Glob, Grep | default |

The orchestrator owns all `AskUserQuestion` calls — plugin agents cannot use it, so the orchestrator collects user input (spec requirements, prod deploy confirmation) before spawning agents.

## Commands

### Core — Automated Pipeline

| Command | Description |
|---------|-------------|
| `/devteam team <feature>` | Run pipeline with configurable stages |

Options:
- `--stages spec,plan,code,review,build,ship,verify` — select which stages to run (default: all)
- `--max-loops N` — optimization loop iterations (default: 3)
- `--skip-spec` — shorthand for removing spec from stages

### Feature Management

| Command | Description |
|---------|-------------|
| `/devteam feature` | List all features, prompt user to select active one |
| `/devteam feature list` | List features with phase/scope/description |
| `/devteam feature delete <name>` | Delete a feature from .dev.yaml and its artifacts |

### Session Management

| Command | Description |
|---------|-------------|
| `/devteam pause` | Save session state (HANDOFF.json + STATE.md) |
| `/devteam resume` | Restore state, show dashboard, suggest next action |

### Project View

| Command | Description |
|---------|-------------|
| `/devteam status` | Dashboard: feature, phase, repos, cluster, build history |
| `/devteam diff [repo]` | Worktree changes across repositories |

### Knowledge

| Command | Description |
|---------|-------------|
| `/devteam learn <topic\|URL\|file>` | Research and create/update interlinked wiki pages |
| `/devteam knowledge <search\|lint\|list>` | Search wiki, run health checks, list pages |

### Project Management

| Command | Description |
|---------|-------------|
| `/devteam init <workspace\|feature>` | Initialize workspace or add a new feature |
| `/devteam cluster <add\|use\|list>` | Manage K8s cluster profiles |
| `/devteam clean [--dry-run]` | Clean orphan worktrees, stale images, K8s resources |

## Architecture

```
User → /devteam team my-feature --stages code,review
         │
         ├── Command (.md)           Entry point (commands/devteam/)
         ├── Orchestrator (.md)      Pipeline coordinator (skills/orchestrator.md)
         ├── Agents (.md)            8 native subagent types (agents/)
         ├── CLI (.cjs)              State & config management (lib/)
         └── Hooks (.js)             Context monitor, persistent mode, statusline (hooks/)
```

### Pipeline Flow

```
/devteam team my-feature --stages code,review,build
  │
  ├── TeamCreate("devteam-my-feature")
  ├── Create tasks only for selected stages (dynamic dependency chain)
  ├── Write pipeline_stages to STATE.md for checkpoint tracking
  │
  ├── [spec]    Guard: skip (not in stages)
  ├── [plan]    Guard: skip (not in stages)
  ├── [code]    Spawn devteam:coder    → atomic commits       → checkpoint "code"
  ├── [review]  Spawn devteam:reviewer → 5-axis review         → checkpoint "review"
  │               └── FAIL? → re-spawn devteam:coder (max 2 cycles)
  ├── [build]   Spawn devteam:builder  → Docker build + push   → checkpoint "build"
  ├── [ship]    Guard: skip (not in stages)
  ├── [verify]  Guard: skip (not in stages)
  │
  ├── CLEANUP: update phase, checkpoint, TeamDelete
  └── Resume: if interrupted, INIT detects completed_stages and offers to continue
```

### Checkpoint Resume

Every completed stage writes to STATE.md:
```yaml
pipeline_stages: "code,review,build"
completed_stages: "code,review"
pipeline_loop_count: "0"
```

If the orchestrator is interrupted mid-pipeline, the next `/devteam team` invocation detects prior progress and offers: "Resume from build? Or restart?"

### Feedback Loops

- **Review loop**: Reviewer FAIL → Coder fix → Reviewer re-check (max 2 cycles)
- **Optimization loop**: Verifier FAIL → vLLM-Opter analysis → Planner re-plan → full re-execution (max N loops, configurable via `tuning.max_optimization_loops`)

### Anti-Rationalization

Every skill and agent includes:
- **Anti-rationalization table**: common excuses mapped to reality checks
- **Red flags**: warning signs that the agent is cutting corners
- **Verification checklist**: concrete evidence required before proceeding

### Directory Layout

```
devteam/
├── .claude-plugin/
│   ├── plugin.json                # Plugin manifest (devteam v2.1.0)
│   └── marketplace.json           # Marketplace listing
│
├── agents/                        # 8 specialized agent definitions
│   ├── spec.md                    # Requirements → spec.md
│   ├── planner.md                 # Spec → wave-grouped plan.md
│   ├── coder.md                   # Plan → atomic commits (acceptEdits)
│   ├── reviewer.md                # Code → 5-axis review (read-only)
│   ├── builder.md                 # Code → Docker image + push
│   ├── shipper.md                 # Image → K8s deploy + health check
│   ├── verifier.md                # Deploy → smoke + 3x benchmarks
│   └── vllm-opter.md              # FAIL → profiler analysis + guidance
│
├── commands/devteam/              # 11 slash commands
│   ├── _registry.yaml             # Source of truth
│   └── *.md                       # Generated from registry
│
├── skills/                        # Process definitions
│   ├── SKILL.md                   # Meta-skill: routing table + 6 core behaviors
│   ├── orchestrator.md            # Configurable pipeline with checkpoint resume
│   ├── learn.md                   # Wiki ingest (code/URL/file sources)
│   ├── pause.md                   # Session state save
│   ├── resume.md                  # Session state restore
│   └── references/schema.md       # .dev.yaml schema reference
│
├── lib/                           # Node.js CLI modules
│   ├── devteam.cjs                # CLI entry point
│   ├── init.cjs                   # Compound context loader (17 workflow types)
│   ├── config.cjs                 # .dev.yaml loading + feature auto-select
│   ├── state.cjs                  # Phase + STATE.md field management
│   ├── session.cjs                # STATE.md + HANDOFF.json read/write
│   ├── checkpoint.cjs             # Devlog checkpoints
│   ├── yaml.cjs                   # YAML parser
│   └── core.cjs                   # Shared utilities
│
├── hooks/                         # Claude Code hooks
│   ├── hooks.json                 # Hook registrations
│   ├── my-dev-context-monitor.js  # PostToolUse: context window warnings (35%/25%)
│   ├── devflow-persistent.js      # Stop: persistent mode engine
│   └── my-dev-statusline.js       # Statusline: model | ctx | project | feature | phase
│
├── templates/STATE.md             # STATE.md template (with pipeline checkpoint fields)
└── bin/
    ├── generate-commands.cjs      # Regenerate commands from registry
    ├── sync-cache.sh              # Sync local repo → plugin cache
    └── setup.sh                   # Local dev verification
```

## Configuration

Create `.dev.yaml` in your project root (or let `/devteam init` generate it):

```yaml
schema_version: 2

workspace: ~/my-project
vault: ~/Obsidian/MyVault              # Optional: wiki persistence

repos:
  my-repo:
    upstream: https://github.com/org/repo
    baselines:
      v1.0: my-repo-v1.0

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
  active_feature: my-feature           # optional — auto-selects if only 1 feature
  active_cluster: dev-cluster

features:
  my-feature:
    description: "My awesome feature"
    phase: spec                        # spec|plan|code|test|review|ship|debug|dev|completed
    scope:
      my-repo:
        base_ref: v1.0
        dev_worktree: my-repo-dev
    ship:
      strategy: k8s                    # docker | k8s | ci-cd
```

Feature selection: if only one feature exists it's auto-selected. If multiple exist and no `--feature` or `active_feature` is set, the skill prompts you to choose.

See [`skills/references/schema.md`](skills/references/schema.md) for the complete schema reference.

## Key Concepts

### Configurable Stages

Not every task needs all 7 stages. Pick what you need:

```bash
/devteam team feat --stages code,review          # Quick fix: just code + review
/devteam team feat --stages plan,code,review     # Feature: plan → code → review
/devteam team feat                                # Full pipeline: all 7 stages
```

### Native Agent Types

Agents are spawned with `subagent_type: "devteam:<name>"`, not as generic agents reading instruction files. This means:
- **Tool restrictions enforced by Claude Code** — reviewer truly cannot write files
- **permissionMode respected** — coder's `acceptEdits` auto-approves file changes
- **System prompt auto-loaded** — no "read your .md file" indirection

### Wave-Based Parallel Execution

The planner groups independent tasks into waves. Tasks within a wave execute in parallel, each producing atomic git commits. Dependencies between waves are respected sequentially.

### Strategy-Driven Shipping

`/devteam team` reads `ship.strategy` from `.dev.yaml` and routes to the appropriate flow:
- **docker** — build image → push → update tag
- **k8s** — build + deploy to cluster → wait ready → health check
- **ci-cd** — trigger CI pipeline → wait → verify

### Namespace Safety

All `kubectl` commands are enforced with `-n <namespace>`. Production clusters (`safety: prod`) require user confirmation (via orchestrator's AskUserQuestion) before deployment.

### Three-Tier Knowledge

1. **Wiki Index** (`wiki/index.md`) — always loaded, content catalog
2. **Wiki Pages** (`wiki/` + `experience/`) — loaded on demand via semantic matching
3. **Archive** (`devlog/`, `archive/`) — search only, never loaded into context

### Session Handoff

`/devteam pause` captures uncommitted files, plan progress, and context notes into `HANDOFF.json` + `STATE.md`. `/devteam resume` restores everything — zero-loss across sessions.

### Hooks

| Hook | Event | Purpose |
|------|-------|---------|
| Context Monitor | PostToolUse | Warns at 35% (warning) and 25% (critical) context remaining |
| Persistent Mode | Stop | Prevents session exit during active pipeline execution |
| Statusline | Always | Shows `Model | ctx [====    ] 42% | project | feature | [phase]` |

## Prerequisites

**Required:**
- **Node.js** >= 18

**Optional (for specific workflows):**
- **jq** — JSON processing in skill steps
- **kubectl** — K8s operations (ship, cluster, clean)
- **ssh** — remote build server and cluster access

## Local Development

```bash
git clone https://github.com/wz1qqx/devteam.git ~/devteam
bash ~/devteam/bin/setup.sh
```

Sync local changes to plugin cache (auto-runs on git commit via post-commit hook):

```bash
bash bin/sync-cache.sh
```

Regenerate commands after modifying `_registry.yaml`:

```bash
node bin/generate-commands.cjs
```

## License

MIT
