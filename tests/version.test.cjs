'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getRepoRoot, readVersion } = require('../lib/version.cjs');

const repoRoot = getRepoRoot();

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function testVersionFileMatchesPublishedMetadata() {
  const version = readVersion();
  const pluginManifest = readJson('.claude-plugin/plugin.json');
  const marketplaceManifest = readJson('.claude-plugin/marketplace.json');
  const readme = readText('README.md');

  assert.strictEqual(pluginManifest.version, version);
  assert.strictEqual(marketplaceManifest.plugins[0].version, version);
  assert.match(readme, new RegExp(`\\[!\\[v${escapeRegex(version)}\\]\\(`));
}

function testSyncCacheReadsVersionFile() {
  const syncCache = readText('bin/sync-cache.sh');

  assert.match(syncCache, /VERSION="\$\(cat "\$SRC\/VERSION"\)"/);
  assert.doesNotMatch(syncCache, /\b2\.\d+\.\d+\b/);
}

function testSyncVersionCheckPasses() {
  const version = readVersion();
  const output = execFileSync('node', ['bin/sync-version.cjs', '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.match(output, new RegExp(`version sync ok: ${escapeRegex(version)}`));
}

function main() {
  testVersionFileMatchesPublishedMetadata();
  testSyncCacheReadsVersionFile();
  testSyncVersionCheckPasses();
  console.log('version: ok');
}

main();
