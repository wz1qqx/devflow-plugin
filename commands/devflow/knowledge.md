---
name: devflow:knowledge
description: Knowledge base operations - list, coverage, update, search
argument-hint: "<list|coverage|update|search>"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<objective>
Manage the Obsidian knowledge base: list documents, check coverage against codebase, update stale docs, or search by topic.
Requires Obsidian vault to be configured in .dev.yaml. If vault is not set, inform the user.
</objective>

<execution_context>
@~/.claude/my-dev/workflows/knowledge-maintain.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the knowledge-maintain workflow from @~/.claude/my-dev/workflows/knowledge-maintain.md end-to-end.
Load project config via: `node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init knowledge`

Gate: If vault is null in the config output, inform user: "Knowledge base operations require Obsidian vault. Set `vault` in .dev.yaml to enable."
</process>
