# devflow — Universal Development Lifecycle Management

Claude Code plugin for managing multi-repo development lifecycles: structured coding, container build, K8s deploy, verification, observability, and debug workflows.

## Features

- **Structured Coding Pipeline**: spec → discuss → plan → exec → review (wave-based parallel execution)
- **Container Build**: Incremental image tagging with base image + code patch
- **K8s Deployment**: Namespace-safe deploy with rollback support
- **Post-Deploy Verification**: Smoke test, benchmark, accuracy check
- **Observability**: Grafana dashboard deployment + metrics analysis
- **Debug Investigation**: Structured debugging with learned hook evolution
- **Knowledge Management**: Optional Obsidian vault integration for persistent knowledge
- **Session Management**: Pause/resume with zero-loss handoff

## Prerequisites

- **Node.js** >= 18
- **Python 3** (for YAML parsing)
- **jq** (for JSON processing in workflows)
- **kubectl** (for K8s operations)
- **ssh** (for remote build server and cluster access)

## Installation

### Option 1: Local Plugin (Recommended for Development)

```bash
# Clone the repo
git clone <repo-url> ~/Documents/devflow-plugin

# Run setup
bash ~/Documents/devflow-plugin/bin/setup.sh
```

### Option 2: Claude Code Plugin Marketplace

```bash
# Add marketplace (once)
# In Claude Code settings.json, add to extraKnownMarketplaces:
# "devflow": { "source": { "source": "github", "repo": "<org>/devflow-plugin" } }

# Then install
/plugin install devflow@devflow
```

After installation, run `/devflow-setup` in Claude Code to complete setup.

## Quick Start

```bash
# 1. Navigate to your project directory
cd ~/my-project

# 2. Initialize workspace
/devflow:init

# 3. Create a feature
/devflow:init feature my-feature

# 4. Check what to do next
/devflow:next
```

## Commands

| Command | Description |
|---------|-------------|
| `/devflow:next` | Auto-detect state, suggest next step |
| `/devflow:quick` | Ad-hoc task with atomic commits |
| `/devflow:init` | Initialize workspace or create feature |
| `/devflow:code` | Structured coding pipeline |
| `/devflow:build` | Build container image |
| `/devflow:deploy` | Deploy to K8s cluster |
| `/devflow:verify` | Post-deploy verification |
| `/devflow:observe` | Monitoring and metrics |
| `/devflow:debug` | Investigation mode |
| `/devflow:rollback` | Rollback deployment |
| `/devflow:pause` | Save session state |
| `/devflow:resume` | Restore session state |
| `/devflow:status` | Project overview |
| `/devflow:diff` | Show worktree changes |
| `/devflow:clean` | Clean unused resources |
| `/devflow:log` | Quick checkpoint |
| `/devflow:cluster` | Manage cluster profiles |
| `/devflow:learn` | Deep-dive learning |
| `/devflow:knowledge` | Knowledge base operations |
| `/devflow:discuss` | Lock design decisions |
| `/devflow:switch` | Switch active feature |

## Workspace Configuration

Create `.dev.yaml` in your project root (or use `/devflow:init`):

```yaml
schema_version: 2

workspace: ~/my-project
vault: ~/Obsidian/MyVault          # Optional: Obsidian vault for knowledge persistence

repos:
  my-repo:
    upstream: https://github.com/org/repo
    baselines:
      v1.0: my-repo-v1.0           # worktree directory name

build_server:
  ssh: user@build-server
  work_dir: /data/builds
  registry: registry.example.com

clusters:
  dev-cluster:
    ssh: user@jump-server
    namespace: my-namespace
    safety: normal
    hardware:
      gpu: "8x A100"

defaults:
  active_feature: my-feature
  active_cluster: dev-cluster

features:
  my-feature:
    description: "My awesome feature"
    phase: init
    scope:
      my-repo:
        base_ref: v1.0
        dev_worktree: my-repo-dev
    invariants:
      source_restriction: dev_worktree_only
```

See `skills/my-dev/references/schema.md` for the complete schema reference.

## Architecture

```
User → Command (.md) → Workflow (.md) → Agent (.md) + CLI Tools (.cjs)
         Entry Layer    Orchestration     Execution      State Layer
```

- **Commands** (`commands/devflow/`): Thin entry points, route to workflows
- **Workflows** (`skills/my-dev/workflows/`): Step-by-step orchestration
- **Agents** (`skills/my-dev/agents/`): Specialized AI agents with focused roles
- **CLI Tools** (`skills/my-dev/bin/`): Node.js state management tools

## Optional: Obsidian Integration

If you configure `vault` in `.dev.yaml`, devflow will:
- Save learned knowledge from code reviews and debug sessions
- Persist experience patterns for future reference
- Write checkpoint entries to your devlog

Without Obsidian, knowledge stays in `.dev/features/` within your project.

## License

MIT
