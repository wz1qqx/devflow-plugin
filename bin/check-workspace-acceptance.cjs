#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { getRepoRoot } = require('../lib/version.cjs');

const DEFAULT_WORKSPACE_NAME = 'llmd-vllm-v020-pega-v021';
const DEFAULT_WORKSPACE = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  'Documents',
  DEFAULT_WORKSPACE_NAME
);

function parseArgs(argv) {
  const parsed = {
    root: process.env.DEVTEAM_ACCEPTANCE_ROOT || DEFAULT_WORKSPACE,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') {
      parsed.root = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function usage() {
  return [
    'Usage: node bin/check-workspace-acceptance.cjs [--root <workspace>]',
    '',
    `Default workspace: ${DEFAULT_WORKSPACE}`,
  ].join('\n');
}

function runDevteam(repoRoot, args) {
  return execFileSync('node', [path.join(repoRoot, 'lib', 'devteam.cjs'), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function assertIncludes(text, needle, label) {
  if (!String(text).includes(needle)) {
    throw new Error(`${label} did not include expected text: ${needle}`);
  }
}

function assertMatches(text, pattern, label) {
  if (!pattern.test(String(text))) {
    throw new Error(`${label} did not match ${pattern}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const repoRoot = getRepoRoot();
  const workspaceRoot = path.resolve(options.root);
  const configPath = path.join(workspaceRoot, '.devteam', 'config.yaml');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Workspace config not found: ${configPath}`);
  }

  const checks = [];

  const context = runDevteam(repoRoot, [
    'workspace', 'context',
    '--root', workspaceRoot,
    '--for', 'codex',
    '--text',
  ]);
  assertIncludes(context, 'Devteam Workspace Context', 'workspace context');
  assertIncludes(context, 'Choose a track before editing code.', 'workspace context');
  checks.push('workspace context');

  const tracks = runDevteam(repoRoot, [
    'track', 'list',
    '--root', workspaceRoot,
    '--active-only',
    '--text',
  ]);
  assertMatches(tracks, /kimi-pd-pegaflow-v0201/, 'track picker');
  checks.push('track picker');

  const onboarding = runDevteam(repoRoot, [
    'doctor', 'agent-onboarding',
    '--root', workspaceRoot,
    '--text',
  ]);
  assertIncludes(onboarding, 'Status: pass', 'agent onboarding doctor');
  checks.push('agent onboarding');

  const skillLint = runDevteam(repoRoot, [
    'skill', 'lint',
    '--root', workspaceRoot,
    '--text',
  ]);
  assertIncludes(skillLint, 'Status: pass', 'skill lint');
  checks.push('skill lint');

  const skillStatus = runDevteam(repoRoot, [
    'skill', 'status',
    '--root', workspaceRoot,
    '--text',
  ]);
  assertIncludes(skillStatus, 'devteam-console', 'skill status');
  assertIncludes(skillStatus, 'devteam-status', 'skill status');
  assertIncludes(skillStatus, 'vllm-opt', 'skill status');
  assertIncludes(skillStatus, '0 missing', 'skill status');
  assertIncludes(skillStatus, '0 invalid', 'skill status');
  checks.push('skill status');

  process.stdout.write([
    `Workspace acceptance: pass`,
    `Root: ${workspaceRoot}`,
    `Checks: ${checks.join(', ')}`,
    '',
  ].join('\n'));
}

try {
  main();
} catch (err) {
  process.stderr.write(`Workspace acceptance: fail\n${err.message}\n`);
  process.exit(1);
}
