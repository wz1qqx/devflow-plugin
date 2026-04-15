'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.resolve(__dirname, '..', 'lib', 'devteam.cjs');

function runCli(cwd, args) {
  const stdout = execFileSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function createWorkspace({ activeFeature = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-week1-'));
  const workspaceYaml = [
    'schema_version: 2',
    `workspace: ${root}`,
    'defaults:',
    activeFeature ? `  active_feature: ${activeFeature}` : null,
    '  active_cluster: dev',
    '  features:',
    '    - feat-a',
    '    - feat-b',
    'clusters:',
    '  dev:',
    '    namespace: dev-ns',
    'repos:',
    '  repo-a:',
    '    upstream: https://example.com/repo-a.git',
    '    baselines:',
    '      main: repo-a-base',
  ].filter(Boolean).join('\n') + '\n';

  writeFile(path.join(root, 'workspace.yaml'), workspaceYaml);
  writeFile(
    path.join(root, '.dev', 'features', 'feat-a', 'config.yaml'),
    [
      'description: Feature A',
      'phase: spec',
      'scope:',
      '  repo-a:',
      '    base_ref: main',
      '    dev_worktree: repo-a-dev',
      'current_tag: null',
      'base_image: null',
    ].join('\n') + '\n'
  );
  writeFile(
    path.join(root, '.dev', 'features', 'feat-b', 'config.yaml'),
    [
      'description: Feature B',
      'phase: plan',
      'scope:',
      '  repo-a:',
      '    base_ref: main',
      '    dev_worktree: repo-a-dev',
      'current_tag: null',
      'base_image: null',
    ].join('\n') + '\n'
  );

  return root;
}

function testInitClusterWithoutActiveFeature() {
  const root = createWorkspace();
  const result = runCli(root, ['init', 'cluster']);

  assert.strictEqual(result.feature, null);
  assert.deepStrictEqual(result.available_features, ['feat-a', 'feat-b']);
  assert.strictEqual(result.workspace, root);
  assert.strictEqual(result.cluster.name, 'dev');
  assert.strictEqual(result.cluster.namespace, 'dev-ns');
  assert.ok(result.all_clusters.dev);
}

function testInitStatusWithoutActiveFeature() {
  const root = createWorkspace();
  const result = runCli(root, ['init', 'status']);

  assert.strictEqual(result.feature, null);
  assert.deepStrictEqual(result.available_features, ['feat-a', 'feat-b']);
  assert.deepStrictEqual(result.feature_state, {});
  assert.deepStrictEqual(result.build_history, []);
  assert.strictEqual(result.cluster.name, 'dev');
}

function testStateUpdateAllowsEmptyString() {
  const root = createWorkspace({ activeFeature: 'feat-a' });
  const result = runCli(root, ['state', 'update', 'completed_stages', '']);
  const statePath = path.join(root, '.dev', 'features', 'feat-a', 'STATE.md');
  const content = fs.readFileSync(statePath, 'utf8');

  assert.strictEqual(result.field, 'completed_stages');
  assert.strictEqual(result.value, '');
  assert.match(content, /^completed_stages: ""$/m);
}

function main() {
  testInitClusterWithoutActiveFeature();
  testInitStatusWithoutActiveFeature();
  testStateUpdateAllowsEmptyString();
  console.log('week1-core: ok');
}

main();
