#!/usr/bin/env node
// my-dev Statusline — shows model, active feature, phase, context usage
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let input = '';
const timeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(timeout);
  try {
    const data = JSON.parse(input);
    const model = data.model?.display_name || 'Claude';
    const cwd = data.workspace?.current_dir || process.cwd();
    const remaining = data.context_window?.remaining_percentage;

    // Build context bar
    let ctx = '';
    if (remaining != null) {
      const BUFFER = 16.5;
      const usable = Math.max(0, ((remaining - BUFFER) / (100 - BUFFER)) * 100);
      const used = Math.round(100 - usable);
      const filled = Math.floor(used / 10);
      const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
      if (used < 50) ctx = ` \x1b[32m${bar} ${used}%\x1b[0m`;
      else if (used < 75) ctx = ` \x1b[33m${bar} ${used}%\x1b[0m`;
      else ctx = ` \x1b[31m${bar} ${used}%\x1b[0m`;
    }

    // Read active feature from .dev.yaml
    let feature = '';
    let phase = '';
    try {
      const yamlPath = path.join(cwd, '.dev.yaml');
      if (fs.existsSync(yamlPath)) {
        const yaml = fs.readFileSync(yamlPath, 'utf8');
        const fm = yaml.match(/active_feature:\s*(\S+)/);
        if (fm) feature = fm[1];
        // Find phase for active feature — simple regex
        if (feature) {
          const phaseMatch = yaml.match(new RegExp(feature + '[\\s\\S]*?phase:\\s*(\\S+)'));
          if (phaseMatch) phase = phaseMatch[1];
        }
      }
    } catch (e) { /* ignore */ }

    // Compose statusline
    const parts = [model];
    if (feature) parts.push(`\x1b[36m${feature}\x1b[0m`);
    if (phase) parts.push(`\x1b[33m${phase}\x1b[0m`);
    parts.push(ctx);

    process.stdout.write(parts.join(' \x1b[90m|\x1b[0m '));
  } catch (e) {
    process.exit(0);
  }
});
