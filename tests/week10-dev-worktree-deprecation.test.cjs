'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.resolve(__dirname, '..', 'lib', 'devteam.cjs');

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function runCliRaw(cwd, args) {
  return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
}

function createWorkspaceWithLegacyDevWorktree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-week10-dev-worktree-legacy-'));
  writeFile(path.join(root, 'workspace.yaml'), [
    'schema_version: 2',
    `workspace: ${root}`,
    'defaults:',
    '  features:',
    '    - feat-a',
    'repos: {}',
    'clusters: {}',
  ].join('\n') + '\n');
  writeFile(path.join(root, '.dev', 'features', 'feat-a', 'config.yaml'), [
    'description: feat-a',
    'phase: code',
    'scope:',
    '  repo-a:',
    '    dev_worktree: repo-a-dev',
    'current_tag: null',
    'base_image: null',
  ].join('\n') + '\n');
  return root;
}

function createWorkspaceWithDevSlot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-week10-dev-worktree-slot-'));
  writeFile(path.join(root, 'workspace.yaml'), [
    'schema_version: 2',
    `workspace: ${root}`,
    'defaults:',
    '  features:',
    '    - feat-a',
    'repos:',
    '  repo-a:',
    '    dev_slots:',
    '      slot-a:',
    '        worktree: repo-a-dev',
    'clusters: {}',
  ].join('\n') + '\n');
  writeFile(path.join(root, '.dev', 'features', 'feat-a', 'config.yaml'), [
    'description: feat-a',
    'phase: code',
    'scope:',
    '  repo-a:',
    '    dev_slot: slot-a',
    'current_tag: null',
    'base_image: null',
  ].join('\n') + '\n');
  return root;
}

function testWarnsWhenUsingLegacyScopeDevWorktree() {
  const root = createWorkspaceWithLegacyDevWorktree();
  const raw = runCliRaw(root, ['config', 'load']);
  assert.strictEqual(raw.status, 0);
  assert.match(raw.stderr, /dev_worktree is deprecated/i);
  assert.match(raw.stderr, /scope\.repo-a\.dev_slot/i);
}

function testNoDeprecationWarningWhenUsingDevSlot() {
  const root = createWorkspaceWithDevSlot();
  const raw = runCliRaw(root, ['config', 'load']);
  assert.strictEqual(raw.status, 0);
  assert.doesNotMatch(raw.stderr, /dev_worktree is deprecated/i);
}

function main() {
  testWarnsWhenUsingLegacyScopeDevWorktree();
  testNoDeprecationWarningWhenUsingDevSlot();
  console.log('week10-dev-worktree-deprecation: ok');
}

main();
