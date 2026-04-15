'use strict';

const fs = require('fs');
const path = require('path');

function getRepoRoot() {
  return path.join(__dirname, '..');
}

function getVersionFilePath() {
  return path.join(getRepoRoot(), 'VERSION');
}

function readVersion() {
  const version = fs.readFileSync(getVersionFilePath(), 'utf8').trim();
  if (!version) {
    throw new Error('VERSION file is empty');
  }
  return version;
}

module.exports = {
  getRepoRoot,
  getVersionFilePath,
  readVersion,
};
