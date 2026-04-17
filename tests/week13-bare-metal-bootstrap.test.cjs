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

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-week13-bare-bootstrap-'));
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
    'description: bootstrap bare metal',
    'phase: code',
    'scope: {}',
  ].join('\n') + '\n');
  return root;
}

function testScaffoldCreatesFilesAndUpdatesFeatureConfig() {
  const root = makeWorkspace();
  const result = runCli(root, [
    'init', 'bare-metal',
    '--feature', 'feat-a',
    '--host', 'root@10.1.2.3',
    '--profile', 'lab',
    '--config', 'pp2tp2-decode-tp4',
  ]);

  assert.strictEqual(result.feature, 'feat-a');
  assert.strictEqual(result.feature_config_updated, true);

  const rapidDir = path.join(root, '.dev', 'rapid-test');
  const syncPath = path.join(rapidDir, 'sync.sh');
  const startPath = path.join(rapidDir, 'start.sh');
  const setupPath = path.join(rapidDir, 'setup.sh');
  const envPath = path.join(rapidDir, 'lab.env');
  assert.ok(fs.existsSync(syncPath), 'sync.sh should exist');
  assert.ok(fs.existsSync(startPath), 'start.sh should exist');
  assert.ok(fs.existsSync(setupPath), 'setup.sh should exist');
  assert.ok(fs.existsSync(envPath), 'profile env should exist');

  const envText = fs.readFileSync(envPath, 'utf8');
  assert.match(envText, /RAPID_HOST=root@10\.1\.2\.3/);
  assert.match(envText, /RAPID_DEFAULT_CONFIG=pp2tp2-decode-tp4/);

  const config = runCli(root, ['config', 'load']);
  const ship = config.features['feat-a'].ship;
  assert.strictEqual(ship.strategy, 'bare_metal');
  assert.strictEqual(ship.metal.host, 'root@10.1.2.3');
  assert.strictEqual(ship.metal.profile, 'lab');
  assert.strictEqual(ship.metal.config, 'pp2tp2-decode-tp4');
  assert.strictEqual(ship.metal.build_mode, 'sync_only');
  assert.strictEqual(ship.metal.sync_script, '.dev/rapid-test/sync.sh');
  assert.strictEqual(ship.metal.start_script, '.dev/rapid-test/start.sh');
  assert.strictEqual(ship.metal.setup_script, '.dev/rapid-test/setup.sh');
  assert.strictEqual(ship.metal.service_url, '10.1.2.3:8000');
}

function testNoWriteConfigLeavesShipUnset() {
  const root = makeWorkspace();
  const result = runCli(root, [
    'init', 'bare-metal',
    '--feature', 'feat-a',
    '--host', 'root@10.9.9.9',
    '--profile', 'noconfig',
    '--no-write-config',
  ]);
  assert.strictEqual(result.feature_config_updated, false);

  const config = runCli(root, ['config', 'load']);
  assert.strictEqual(config.features['feat-a'].ship.strategy, null);
  assert.strictEqual(config.features['feat-a'].ship.metal, null);
}

function testExistingProfileIsNotOverwrittenWithoutForce() {
  const root = makeWorkspace();
  runCli(root, [
    'init', 'bare-metal',
    '--feature', 'feat-a',
    '--host', 'root@10.2.2.2',
    '--profile', 'keepme',
    '--no-write-config',
  ]);

  const profilePath = path.join(root, '.dev', 'rapid-test', 'keepme.env');
  fs.writeFileSync(profilePath, 'RAPID_HOST=custom-host\n', 'utf8');

  const second = runCli(root, [
    'init', 'bare-metal',
    '--feature', 'feat-a',
    '--host', 'root@10.3.3.3',
    '--profile', 'keepme',
    '--no-write-config',
  ]);

  const after = fs.readFileSync(profilePath, 'utf8');
  assert.strictEqual(after, 'RAPID_HOST=custom-host\n');
  assert.ok(
    second.file_changes.skipped.includes(profilePath),
    'existing profile should be skipped without --force'
  );
}

function main() {
  testScaffoldCreatesFilesAndUpdatesFeatureConfig();
  testNoWriteConfigLeavesShipUnset();
  testExistingProfileIsNotOverwrittenWithoutForce();
  console.log('week13-bare-metal-bootstrap: ok');
}

main();
