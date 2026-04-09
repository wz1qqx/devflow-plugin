#!/usr/bin/env node
// devflow Statusline — displays project/feature/phase in Claude Code status bar
//
// Output format: plain text string for Claude Code statusLine command type.
// Discovers .dev.yaml by walking up from CWD. Falls back gracefully.

'use strict';

const fs = require('fs');
const path = require('path');

function findDevYaml(startDir) {
  let dir = startDir;
  for (let i = 0; i < 20; i++) {
    const candidate = path.join(dir, '.dev.yaml');
    if (fs.existsSync(candidate)) return { file: candidate, root: dir };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function parseYamlValue(content, key) {
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'm');
  const m = content.match(re);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

function parseStateFrontmatter(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return {};
  const result = {};
  for (const line of fmMatch[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) result[m[1]] = m[2].trim();
  }
  return result;
}

function main() {
  const cwd = process.cwd();
  const found = findDevYaml(cwd);

  if (!found) {
    process.stdout.write('devflow');
    return;
  }

  const { file, root } = found;
  let projectName = 'devflow';
  try {
    const yaml = fs.readFileSync(file, 'utf8');
    projectName = parseYamlValue(yaml, 'project') || path.basename(root);
  } catch (_) {
    projectName = path.basename(root);
  }

  // Try to get active feature and phase from STATE.md
  let feature = '';
  let phase = '';
  const statePath = path.join(root, '.dev', 'STATE.md');
  try {
    if (fs.existsSync(statePath)) {
      const stateContent = fs.readFileSync(statePath, 'utf8');
      const fm = parseStateFrontmatter(stateContent);
      feature = fm.current_feature || '';
      phase = fm.feature_stage || fm.phase || '';
    }
  } catch (_) { /* ignore */ }

  // Try features dir as fallback
  if (!feature) {
    const featDir = path.join(root, '.dev', 'features');
    try {
      if (fs.existsSync(featDir)) {
        const dirs = fs.readdirSync(featDir).filter(d =>
          fs.statSync(path.join(featDir, d)).isDirectory()
        );
        if (dirs.length === 1) feature = dirs[0];
      }
    } catch (_) { /* ignore */ }
  }

  // Build status line
  const parts = [projectName];
  if (feature) parts.push(feature);
  if (phase) parts.push(`[${phase}]`);

  process.stdout.write(parts.join(' | '));
}

main();
