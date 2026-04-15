'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getRepoRoot } = require('../lib/version.cjs');

const repoRoot = getRepoRoot();

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function testHookRegistryUsesDevteamEntrypoints() {
  const hooks = readJson('hooks/hooks.json').hooks;
  const postToolUseCommand = hooks.PostToolUse[0].hooks[0].command;
  const stopCommand = hooks.Stop[0].hooks[0].command;

  assert.match(postToolUseCommand, /hooks\/devteam-context-monitor\.js/);
  assert.match(stopCommand, /hooks\/devteam-persistent\.js/);
}

function testLegacyWrappersPointToNewEntrypoints() {
  const contextWrapper = readText('hooks/my-dev-context-monitor.js');
  const persistentWrapper = readText('hooks/devflow-persistent.js');
  const statuslineWrapper = readText('hooks/my-dev-statusline.js');

  assert.match(contextWrapper, /require\('\.\/devteam-context-monitor\.js'\);/);
  assert.match(persistentWrapper, /require\('\.\/devteam-persistent\.js'\);/);
  assert.match(statuslineWrapper, /require\('\.\/devteam-statusline\.js'\)/);
}

function main() {
  testHookRegistryUsesDevteamEntrypoints();
  testLegacyWrappersPointToNewEntrypoints();
  console.log('week4-hooks: ok');
}

main();
