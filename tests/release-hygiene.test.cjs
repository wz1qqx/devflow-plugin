'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getRepoRoot } = require('../lib/version.cjs');

const repoRoot = getRepoRoot();

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function testSetupUsesDevteamPathsOnly() {
  const setup = readText('bin/setup.sh');

  assert.match(
    setup,
    /MARKETPLACE_BIN=\$\(ls ~\/\.claude\/plugins\/cache\/devteam\/devteam\/\*\/lib\/devteam\.cjs/
  );
  assert.doesNotMatch(setup, /python3.*YAML parsing/);
  assert.doesNotMatch(setup, /YAML parsing.*python3/);
}

function main() {
  testSetupUsesDevteamPathsOnly();
  console.log('release-hygiene: ok');
}

main();
