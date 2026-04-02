'use strict';

const path = require('path');
const fs = require('fs');

function output(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

function error(msg) {
  process.stderr.write(`[devflow] ERROR: ${msg}\n`);
  process.exit(1);
}

function parseArgs(args) {
  const result = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    } else {
      result._.push(arg);
    }
  }
  return result;
}

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~/') || p === '~') {
    return path.join(require('os').homedir(), p.slice(2));
  }
  return p;
}

function findWorkspaceRoot(startDir) {
  let dir = startDir || process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.dev.yaml'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

module.exports = { output, error, parseArgs, findWorkspaceRoot, expandHome };
