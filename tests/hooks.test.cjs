'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getRepoRoot } = require('../lib/version.cjs');

const repoRoot = getRepoRoot();

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function testHookRegistryUsesDevteamEntrypoints() {
  const hooks = readJson('hooks/hooks.json').hooks;
  const postToolUseCommand = hooks.PostToolUse[0].hooks[0].command;

  assert.match(postToolUseCommand, /hooks\/devteam-context-monitor\.js/);
  assert.strictEqual(Object.hasOwn(hooks, 'Stop'), false);
}

function main() {
  testHookRegistryUsesDevteamEntrypoints();
  console.log('hooks: ok');
}

main();
