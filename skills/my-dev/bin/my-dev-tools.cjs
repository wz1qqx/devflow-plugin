#!/usr/bin/env node
'use strict';

const { output, error } = require('./lib/core.cjs');

const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];
const rest = args.slice(2);

if (!command) {
  error('Usage: my-dev-tools <command> [subcommand] [args...]\n\nCommands:\n  init <workflow> [args]     Context loading for a workflow\n  config load|get <key>      Project config operations\n  state get|update [args]    State management\n  features list|active|switch Feature management\n  checkpoint [args]          Write checkpoint to Obsidian + feature devlog\n  resolve-model <agent>      Model routing for agent\n  verify plan-structure <f>  Verify plan file structure\n  template fill <type>       Fill a template');
}

try {
  switch (command) {
    case 'init': {
      const { initWorkflow } = require('./lib/init.cjs');
      initWorkflow(subcommand, rest);
      break;
    }
    case 'config': {
      const { handleConfig } = require('./lib/config.cjs');
      handleConfig(subcommand, rest);
      break;
    }
    case 'state': {
      const { handleState } = require('./lib/state.cjs');
      handleState(subcommand, rest);
      break;
    }
    case 'resolve-model': {
      const MODEL_MAP = {
        'my-dev-researcher': 'opus',
        'my-dev-planner': 'opus',
        'my-dev-plan-checker': 'opus',
        'my-dev-executor': 'opus',
        'my-dev-reviewer': 'opus',
        'my-dev-verifier': 'opus',
        'my-dev-debugger': 'opus',
      };
      const agent = subcommand;
      if (!agent) error('Usage: resolve-model <agent-name>');
      const model = MODEL_MAP[agent];
      if (!model) {
        process.stderr.write(`[my-dev-tools] WARN: Unknown agent '${agent}', defaulting to sonnet. Known: ${Object.keys(MODEL_MAP).join(', ')}\n`);
      }
      output({ agent, model: model || 'sonnet' });
      break;
    }
    case 'verify': {
      const { handleVerify } = require('./lib/verify.cjs');
      handleVerify(subcommand, rest);
      break;
    }
    case 'template': {
      const { handleTemplate } = require('./lib/template.cjs');
      handleTemplate(subcommand, rest);
      break;
    }
    case 'checkpoint': {
      const { writeCheckpoint } = require('./lib/checkpoint.cjs');
      // checkpoint 不用 subcommand，所有 args 直接传入
      writeCheckpoint(null, args.slice(1));
      break;
    }
    case 'features': {
      const { loadConfig, getActiveFeature, listFeatures } = require('./lib/config.cjs');
      const { switchActiveFeature } = require('./lib/state.cjs');
      const config = loadConfig();

      if (!subcommand || subcommand === 'list') {
        const features = listFeatures(config);
        output({ features });
      } else if (subcommand === 'active') {
        const feature = getActiveFeature(config);
        output({
          name: feature.name,
          description: feature.description || '',
          phase: feature.phase || 'init',
          scope: Object.keys(feature.scope || {}),
        });
      } else if (subcommand === 'switch') {
        const name = rest[0];
        if (!name) {
          error('Usage: features switch <name>\n\nAvailable features: ' +
            Object.keys(config.features || {}).join(', '));
        }
        const result = switchActiveFeature(config, name);
        output(result);
      } else {
        error(`Unknown features subcommand: ${subcommand}. Use: list, active, switch`);
      }
      break;
    }
    default:
      error(`Unknown command: ${command}`);
  }
} catch (err) {
  error(err.message);
}
