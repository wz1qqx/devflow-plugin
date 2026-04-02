---
name: devflow:init
description: "Initialize workspace (v2) or add a new feature"
argument-hint: "[workspace | feature <name>]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<objective>
Route to the appropriate init workflow based on arguments:
- `workspace` → full workspace setup (repos, infra, baselines, .dev.yaml)
- `feature <name>` → add a new feature to an existing workspace
- (no args) → auto-detect: if .dev.yaml exists, assume feature init; otherwise workspace init
</objective>

<execution_context>
Workspace init: @../../skills/my-dev/workflows/init.md
Feature init:   @../../skills/my-dev/workflows/init-feature.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
## 1. Parse arguments

Extract the first token from `$ARGUMENTS`:
- If first token is `workspace` → go to step 2a
- If first token is `feature` → go to step 2b (second token is the feature name)
- If empty or unrecognized → go to step 2c (auto-detect)

## 2a. Workspace Init

Execute @../../skills/my-dev/workflows/init.md end-to-end.

Pre-check: if `.dev.yaml` already exists:
- Check `schema_version`. If `1` → suggest: "v1 config detected. Run `/devflow:init workspace` to upgrade to v2."
- If `2` → warn: "Workspace already initialized. Proceeding will overwrite. Continue? (y/n)"

## 2b. Feature Init

Execute @../../skills/my-dev/workflows/init-feature.md with the feature name.

Pre-check: if `.dev.yaml` does not exist → abort with: "No workspace config found. Run `/devflow:init workspace` first."

## 2c. Auto-detect

```
if .dev.yaml exists:
  if schema_version == 1:
    → suggest: "/devflow:init workspace" to set up v2 schema
  if schema_version == 2:
    → ask: "Feature name to initialize?"
    → then run feature init workflow
else:
  → run workspace init workflow
```
</process>
