'use strict';

const fs = require('fs');
const path = require('path');
const { output, error, parseArgs } = require('./core.cjs');

const TEMPLATES = {
  spec: `# Feature Spec: {{feature}}

Created: {{date}}
Project: {{project}}
Status: draft

## Goal
{{goal}}

## Context
{{context}}

## Scope

### Repos & Files
| Repo | Worktree | Files | Change Type |
|------|----------|-------|-------------|
| | | | |

### Out of Scope

## Constraints
- API Compatibility:
- Build Mode:
- Cross-Repo Dependencies:

## Verification Criteria
- [ ]
`,

  plan: `# Implementation Plan: {{feature}}

Created: {{date}}
Spec: .dev/specs/{{feature}}.md
Build Mode: {{build_mode}}
Estimated Tasks: {{task_count}}
Waves: {{wave_count}}

## Wave 1 (parallel)

### Task 1: {{task_title}}
- **Repo**: {{repo}}
- **Worktree**: {{worktree}}
- **Files to Modify**:
- **Files to Read**:
- **Action**:
- **Depends On**: none
- **Delegation**: subagent
- **Status**: pending

## Cross-Repo Compatibility Check
- [ ]

## Risk Assessment
-
`,

  review: `# Code Review: {{feature}}

Date: {{date}}
Reviewer: my-dev-reviewer (automated)

## Summary
| Repo | Files Changed | Insertions | Deletions |
|------|--------------|------------|-----------|
| | | | |

## Findings

### CRITICAL (must fix)

### HIGH (should fix)

### MEDIUM (consider)

### LOW (minor)

## Cross-Repo Compatibility

## Invariant Compliance

## Security

## Spec Alignment

## Verdict:
`,

  summary: `## Verification Summary: {{tag}}

Date: {{date}}
Cluster: {{cluster}}

### Results
| Metric | Current | Previous | Delta | Status |
|--------|---------|----------|-------|--------|
| | | | | |

### Verdict:
`,
};

function fillTemplate(type, vars) {
  const template = TEMPLATES[type];
  if (!template) {
    error(`Unknown template type: ${type}. Available: ${Object.keys(TEMPLATES).join(', ')}`);
  }

  let filled = template;
  // Default vars
  const defaults = {
    date: new Date().toISOString().split('T')[0],
  };
  const allVars = { ...defaults, ...vars };

  for (const [key, value] of Object.entries(allVars)) {
    filled = filled.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
  }

  return filled;
}

function handleTemplate(subcommand, args) {
  if (subcommand === 'fill') {
    const type = args[0];
    if (!type) error('Usage: template fill <type> [--key value ...]');
    const parsed = parseArgs(args.slice(1));
    // Convert parsed args to vars (exclude the _ positional array)
    const vars = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k !== '_') vars[k] = v;
    }
    const result = fillTemplate(type, vars);
    output({ type, content: result });
  } else if (subcommand === 'list') {
    output({ templates: Object.keys(TEMPLATES) });
  } else {
    error(`Unknown template subcommand: ${subcommand}. Use: fill, list`);
  }
}

module.exports = { fillTemplate, handleTemplate };
