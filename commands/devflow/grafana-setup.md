---
name: devflow:grafana-setup
description: Deploy Grafana monitoring stack in a k8s cluster
argument-hint: "[--cluster <name>]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---
<objective>
Set up Grafana + Prometheus monitoring in the specified Kubernetes cluster.
</objective>

<execution_context>
@../../skills/my-dev/grafana-setup.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover CLI tool and load config:
```bash
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)
INIT=$(node "$DEVFLOW_BIN" init grafana-setup)
```

**Step 2**: Read the skill file and execute it end-to-end:
```bash
SKILL_FILE=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/grafana-setup.md 2>/dev/null | head -1)
```
Read `$SKILL_FILE` for the full process, then follow it step by step.
</process>
