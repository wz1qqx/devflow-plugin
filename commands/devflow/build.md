---
name: devflow:build
description: Build container image with incremental tag chain
argument-hint: "[tag] [--push] [variant]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---
<objective>
Build a container image using the incremental tag chain from .dev.yaml. BASE_IMAGE is always current_tag (never the official base). Supports variant builds (e.g., pegaflow).
</objective>

<execution_context>
@~/.claude/my-dev/workflows/build.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the build workflow from @~/.claude/my-dev/workflows/build.md end-to-end.
Load project config via: `node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init build`
</process>
