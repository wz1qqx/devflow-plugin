'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getRepoRoot } = require('../lib/version.cjs');

const repoRoot = getRepoRoot();
const LEGACY_PATTERN = /DEVFLOW_BIN|devflow|my-dev/;

const ALLOWED_LEGACY_FILES = new Set([
  'README.md',
  'bin/setup.sh',
  'hooks/devflow-persistent.js',
  'hooks/my-dev-context-monitor.js',
  'hooks/my-dev-statusline.js',
  'hooks/devteam-context-monitor.js',
  'hooks/devteam-persistent.js',
]);

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function listFiles(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return [relativePath];

  const files = [];
  for (const entry of fs.readdirSync(absolutePath)) {
    const childRelative = path.join(relativePath, entry);
    files.push(...listFiles(childRelative));
  }
  return files;
}

function testLegacyTermsAreConfinedToCompatibilityFiles() {
  const scanRoots = [
    'README.md',
    'bin',
    'hooks',
    'skills',
    'lib',
    'commands/devteam',
  ];
  const candidateFiles = scanRoots.flatMap(listFiles)
    .filter(file => file.endsWith('.md') || file.endsWith('.js') || file.endsWith('.cjs') || file.endsWith('.sh'));

  for (const relativePath of candidateFiles) {
    const content = readText(relativePath);
    if (!LEGACY_PATTERN.test(content)) {
      continue;
    }
    assert.ok(
      ALLOWED_LEGACY_FILES.has(relativePath),
      `Legacy naming should not appear in ${relativePath}`
    );
  }
}

function testSetupPrefersDevteamCacheAndLabelsFallbackAsLegacy() {
  const setup = readText('bin/setup.sh');

  assert.match(
    setup,
    /MARKETPLACE_BIN=\$\(ls ~\/\.claude\/plugins\/cache\/devteam\/devteam\/\*\/lib\/devteam\.cjs/
  );
  assert.match(
    setup,
    /Legacy cache path from pre-rename installs/
  );
  assert.match(
    setup,
    /cache\/devflow\/devteam\/\*\/lib\/devteam\.cjs/
  );
  assert.match(
    setup,
    /\[WARN\]\[LEGACY\] ~\/\.claude\/my-dev symlink exists/
  );
}

function testCompatibilityWrappersExplicitlyMarked() {
  assert.match(readText('README.md'), /Backward-compat statusline wrapper/);
  assert.match(readText('hooks/devflow-persistent.js'), /Backward-compat wrapper/);
  assert.match(readText('hooks/my-dev-context-monitor.js'), /Backward-compat wrapper/);
  assert.match(readText('hooks/my-dev-statusline.js'), /Backward-compat wrapper/);
}

function main() {
  testLegacyTermsAreConfinedToCompatibilityFiles();
  testSetupPrefersDevteamCacheAndLabelsFallbackAsLegacy();
  testCompatibilityWrappersExplicitlyMarked();
  console.log('week4-release-hygiene: ok');
}

main();
