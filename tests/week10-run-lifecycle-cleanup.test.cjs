'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.resolve(__dirname, '..', 'lib', 'devteam.cjs');

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function runCli(cwd, args) {
  const stdout = execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
  return JSON.parse(stdout);
}

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-week10-run-lifecycle-'));
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
    'scope: {}',
    'current_tag: null',
    'base_image: null',
  ].join('\n') + '\n');
  return root;
}

function testRunInitDoesNotReuseCompletedPipelineSnapshot() {
  const root = createWorkspace();
  const first = runCli(root, ['run', 'init', '--feature', 'feat-a', '--stages', 'code']);
  runCli(root, ['pipeline', 'init', '--feature', 'feat-a', '--stages', 'code']);
  runCli(root, ['pipeline', 'complete', '--feature', 'feat-a', '--stages', 'code']);

  const stateMd = fs.readFileSync(path.join(root, '.dev', 'features', 'feat-a', 'STATE.md'), 'utf8');
  assert.match(stateMd, /^feature_stage: completed$/m);

  const second = runCli(root, ['run', 'init', '--feature', 'feat-a', '--stages', 'code']);
  assert.strictEqual(second.action, 'init');
  assert.notStrictEqual(second.run.run_id, first.run.run_id);
}

function main() {
  testRunInitDoesNotReuseCompletedPipelineSnapshot();
  console.log('week10-run-lifecycle-cleanup: ok');
}

main();
