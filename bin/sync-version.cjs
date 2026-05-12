#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { readVersion, getRepoRoot } = require('../lib/version.cjs');

const repoRoot = getRepoRoot();
const targetVersion = readVersion();
const checkOnly = process.argv.includes('--check');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function syncPluginManifest() {
  const filePath = path.join(repoRoot, '.claude-plugin', 'plugin.json');
  const manifest = readJson(filePath);
  const changed = manifest.version !== targetVersion;
  if (changed && !checkOnly) {
    manifest.version = targetVersion;
    writeJson(filePath, manifest);
  }
  return changed ? [`${path.relative(repoRoot, filePath)} version != ${targetVersion}`] : [];
}

function syncMarketplaceManifest() {
  const filePath = path.join(repoRoot, '.claude-plugin', 'marketplace.json');
  const manifest = readJson(filePath);
  const plugin = manifest.plugins && manifest.plugins[0];
  const changed = !plugin || plugin.version !== targetVersion;
  if (changed && !checkOnly) {
    if (!plugin) throw new Error('marketplace.json missing plugins[0]');
    plugin.version = targetVersion;
    writeJson(filePath, manifest);
  }
  return changed ? [`${path.relative(repoRoot, filePath)} plugins[0].version != ${targetVersion}`] : [];
}

function syncReadme() {
  const filePath = path.join(repoRoot, 'README.md');
  const current = fs.readFileSync(filePath, 'utf8');
  const next = current.replace(
    /\[!\[v[^\]]+\]\(https:\/\/img\.shields\.io\/badge\/version-[^)]+\)\]\(https:\/\/github\.com\/wz1qqx\/devteam\)/,
    `[![v${targetVersion}](https://img.shields.io/badge/version-${targetVersion}-orange)](https://github.com/wz1qqx/devteam)`
  );

  const changed = current !== next;
  if (changed && !checkOnly) {
    fs.writeFileSync(filePath, next, 'utf8');
  }
  return changed ? [`${path.relative(repoRoot, filePath)} version badge != ${targetVersion}`] : [];
}

function main() {
  const mismatches = [
    ...syncPluginManifest(),
    ...syncMarketplaceManifest(),
    ...syncReadme(),
  ];

  if (checkOnly) {
    if (mismatches.length > 0) {
      process.stderr.write(mismatches.join('\n') + '\n');
      process.exit(1);
    }
    process.stdout.write(`version sync ok: ${targetVersion}\n`);
    return;
  }

  process.stdout.write(`synced version: ${targetVersion}\n`);
}

main();
