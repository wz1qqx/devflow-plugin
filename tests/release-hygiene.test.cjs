'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getRepoRoot } = require('../lib/version.cjs');

const repoRoot = getRepoRoot();
const REMOVED_RUNTIME_PATTERN = /DEVFLOW_BIN|devflow|my-dev/;
const SCAN_ROOTS = [
  'README.md',
  'NEXT_SESSION_PLAN.md',
  'bin',
  'hooks',
  'skills',
  'lib',
  'commands/devteam',
];

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function isTracked(relativePath) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', relativePath], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    return true;
  } catch (_) {
    return false;
  }
}

function listFiles(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return [relativePath];

  const files = [];
  for (const entry of fs.readdirSync(absolutePath)) {
    const childRelative = path.join(relativePath, entry);
    files.push(...listFiles(childRelative));
  }
  return files;
}

function testRemovedRuntimeTermsForbiddenInRuntimeDocsAndConfig() {
  const candidateFiles = SCAN_ROOTS.flatMap(listFiles)
    .filter(file => file.endsWith('.md') || file.endsWith('.js') || file.endsWith('.cjs') || file.endsWith('.sh'));
  if (isTracked('.claude/settings.local.json')) {
    candidateFiles.push('.claude/settings.local.json');
  }

  for (const relativePath of candidateFiles) {
    const content = readText(relativePath);
    assert.doesNotMatch(content, REMOVED_RUNTIME_PATTERN, `Removed runtime naming should not appear in ${relativePath}`);
  }
}

function testSetupUsesDevteamPathsOnly() {
  const setup = readText('bin/setup.sh');

  assert.match(
    setup,
    /MARKETPLACE_BIN=\$\(ls ~\/\.claude\/plugins\/cache\/devteam\/devteam\/\*\/lib\/devteam\.cjs/
  );
  assert.doesNotMatch(setup, /cache\/devflow\//);
  assert.doesNotMatch(setup, /\.claude\/my-dev/);
  assert.doesNotMatch(setup, /\.claude\/commands\/devflow/);
  assert.doesNotMatch(setup, /python3.*YAML parsing/);
  assert.doesNotMatch(setup, /YAML parsing.*python3/);
}

function main() {
  testRemovedRuntimeTermsForbiddenInRuntimeDocsAndConfig();
  testSetupUsesDevteamPathsOnly();
  console.log('release-hygiene: ok');
}

main();
