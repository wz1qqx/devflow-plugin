'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getRepoRoot } = require('../lib/version.cjs');

const repoRoot = getRepoRoot();

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function listCommandDocs() {
  const commandDir = path.join(repoRoot, 'commands', 'devteam');
  return fs.readdirSync(commandDir)
    .filter(name => name.endsWith('.md'))
    .sort()
    .map(name => path.join('commands', 'devteam', name));
}

function testGeneratorUsesDevteamBinOnly() {
  const generator = readText('bin/generate-commands.cjs');

  assert.match(generator, /DEVTEAM_BIN/);
  assert.doesNotMatch(generator, /DEVFLOW_BIN/);
  assert.doesNotMatch(generator, /INIT=\$\(node "\$DEVTEAM_BIN" init/);
  assert.doesNotMatch(generator, /available_features/);
}

function testGeneratedCommandDocsUseDevteamBinOnly() {
  const docs = listCommandDocs();
  assert.ok(docs.length > 0, 'expected generated command docs');

  for (const relativePath of docs) {
    const content = readText(relativePath);
    assert.match(content, /DEVTEAM_BIN/, `${relativePath} should contain DEVTEAM_BIN`);
    assert.doesNotMatch(content, /DEVFLOW_BIN/, `${relativePath} should not contain DEVFLOW_BIN`);
    assert.doesNotMatch(content, /INIT=\$\(node "\$DEVTEAM_BIN" init/, `${relativePath} should not bootstrap the removed init flow`);
    assert.doesNotMatch(content, /available_features/, `${relativePath} should not prompt for removed features`);
    assert.doesNotMatch(content, /\.dev\/features/, `${relativePath} should not mention removed feature state`);
  }
}

function main() {
  testGeneratorUsesDevteamBinOnly();
  testGeneratedCommandDocsUseDevteamBinOnly();
  console.log('command-generation: ok');
}

main();
