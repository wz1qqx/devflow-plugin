'use strict';

const fs = require('fs');
const path = require('path');
const { output, error, findWorkspaceRoot } = require('./core.cjs');

function verifyPlanStructure(planPath) {
  if (!fs.existsSync(planPath)) {
    return { valid: false, errors: [`Plan file not found: ${planPath}`] };
  }
  const content = fs.readFileSync(planPath, 'utf8');
  const errors = [];
  const warnings = [];

  // Required sections
  const requiredPatterns = [
    { pattern: /^# Implementation Plan:/m, name: 'Plan title' },
    { pattern: /^## (Wave|Task List)/m, name: 'Wave/Task section' },
    { pattern: /^### Task \d+/m, name: 'At least one task' },
  ];
  for (const { pattern, name } of requiredPatterns) {
    if (!pattern.test(content)) {
      errors.push(`Missing required section: ${name}`);
    }
  }

  // Required task fields
  const taskBlocks = content.split(/^### Task \d+/m).slice(1);
  const requiredFields = ['Repo', 'Worktree', 'Files to Modify', 'Action', 'Depends On'];
  for (let i = 0; i < taskBlocks.length; i++) {
    const block = taskBlocks[i];
    for (const field of requiredFields) {
      if (!block.includes(`**${field}**`)) {
        warnings.push(`Task ${i + 1} missing field: ${field}`);
      }
    }
  }

  // Check for cross-repo section
  if (!/Cross-Repo/i.test(content)) {
    warnings.push('Missing Cross-Repo Compatibility section');
  }

  return {
    valid: errors.length === 0,
    task_count: taskBlocks.length,
    errors,
    warnings,
  };
}

function verifyPhaseCompleteness(featureName) {
  const root = findWorkspaceRoot();
  if (!root) return { complete: false, errors: ['No workspace found'] };
  const devDir = path.join(root, '.dev');
  const result = {
    feature: featureName,
    spec: fs.existsSync(path.join(devDir, 'specs', `${featureName}.md`)),
    plan: fs.existsSync(path.join(devDir, 'plans', `${featureName}.md`)),
    review: fs.existsSync(path.join(devDir, 'reviews', `${featureName}.md`)),
  };

  // Check plan task statuses
  const planPath = path.join(devDir, 'plans', `${featureName}.md`);
  if (result.plan) {
    const content = fs.readFileSync(planPath, 'utf8');
    const statusMatches = content.match(/\*\*Status\*\*:\s*(\w+)/g) || [];
    const statuses = statusMatches.map(m => m.replace(/\*\*Status\*\*:\s*/, ''));
    result.task_statuses = {
      total: statuses.length,
      done: statuses.filter(s => s === 'done').length,
      in_progress: statuses.filter(s => s === 'in_progress').length,
      pending: statuses.filter(s => s === 'pending').length,
      failed: statuses.filter(s => s === 'failed').length,
    };
    result.all_tasks_done = result.task_statuses.done === result.task_statuses.total;
  }

  result.complete = result.spec && result.plan && result.review;
  return result;
}

function handleVerify(subcommand, args) {
  if (subcommand === 'plan-structure') {
    const file = args[0];
    if (!file) error('Usage: verify plan-structure <plan-file>');
    const resolvedPath = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
    output(verifyPlanStructure(resolvedPath));
  } else if (subcommand === 'phase-completeness') {
    const feature = args[0];
    if (!feature) error('Usage: verify phase-completeness <feature-name>');
    output(verifyPhaseCompleteness(feature));
  } else {
    error(`Unknown verify subcommand: ${subcommand}. Use: plan-structure, phase-completeness`);
  }
}

module.exports = { verifyPlanStructure, verifyPhaseCompleteness, handleVerify };
