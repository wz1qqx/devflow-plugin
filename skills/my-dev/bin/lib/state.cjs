'use strict';

const fs = require('fs');
const path = require('path');
const { output, error, findWorkspaceRoot } = require('./core.cjs');
const { loadConfig, getActiveFeature } = require('./config.cjs');

function loadState(featureName) {
  const root = findWorkspaceRoot();
  if (!root) error('.dev.yaml not found');
  const devDir = path.join(root, '.dev');
  const state = { specs: [], plans: [], reviews: [] };
  for (const dir of ['specs', 'plans', 'reviews']) {
    const dirPath = path.join(devDir, dir);
    if (fs.existsSync(dirPath)) {
      state[dir] = fs.readdirSync(dirPath)
        .filter(f => f.endsWith('.md'))
        .map(f => f.replace(/\.md$/, ''));
    }
  }
  return state;
}

/**
 * Get phase for a feature.
 */
function getPhase(config, featureName) {
  const name = featureName || (config.defaults && config.defaults.active_feature);
  if (!name) error('No feature specified');
  const feature = config.features && config.features[name];
  if (!feature) error(`Feature '${name}' not found`);
  return feature.phase || 'init';
}

/**
 * Update phase in .dev.yaml for a feature.
 */
function updatePhase(config, featureName, phase) {
  const validPhases = [
    'init', 'spec', 'discuss', 'plan', 'exec', 'review',
    'build', 'deploy', 'verify', 'observe', 'debug', 'dev', 'completed',
  ];
  if (!validPhases.includes(phase)) {
    error(`Invalid phase '${phase}'. Valid: ${validPhases.join(', ')}`);
  }

  const name = featureName || (config.defaults && config.defaults.active_feature);
  if (!name) error('No feature specified for phase update');

  const yamlPath = config._path;
  let content = fs.readFileSync(yamlPath, 'utf8');
  content = replaceFeatureField(content, name, 'phase', phase);
  fs.writeFileSync(yamlPath, content, 'utf8');
  return { feature: name, phase };
}

/**
 * Update a scalar field within a feature block in .dev.yaml.
 */
function updateFeatureField(config, featureName, field, value) {
  const yamlPath = config._path;
  let content = fs.readFileSync(yamlPath, 'utf8');
  content = replaceFeatureField(content, featureName, field, value);
  fs.writeFileSync(yamlPath, content, 'utf8');
  return { feature: featureName, field, value };
}

/**
 * Internal: replace a scalar field value within a feature block in raw YAML text.
 */
function replaceFeatureField(content, featureName, field, value) {
  const lines = content.split('\n');
  let featureStart = -1;
  let featureIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimEnd();
    const match = trimmed.match(/^(\s+)(\S+):$/) || trimmed.match(/^(\s+)(\S+):\s/);
    if (match && match[2] === featureName) {
      featureStart = i;
      featureIndent = match[1].length;
      break;
    }
  }

  if (featureStart === -1) {
    error(`Feature '${featureName}' not found in YAML`);
  }

  for (let i = featureStart + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const lineIndent = (line.match(/^(\s*)/) || ['', ''])[1].length;
    if (lineIndent <= featureIndent && line.trim() !== '') break;

    const fieldMatch = line.match(/^(\s+)([\w_]+):\s*(.*)/);
    if (fieldMatch && fieldMatch[2] === field) {
      let formatted = value;
      if (typeof value === 'string' && (value.includes(':') || value.includes('#') || value.includes('"'))) {
        formatted = `"${value}"`;
      }
      lines[i] = `${fieldMatch[1]}${field}: ${formatted}`;
      return lines.join('\n');
    }
  }

  error(`Field '${field}' not found in feature '${featureName}'`);
}

/**
 * Switch active feature in .dev.yaml defaults.
 */
function switchActiveFeature(config, featureName) {
  if (!config.features || !config.features[featureName]) {
    error(`Feature '${featureName}' not found. Available: ${Object.keys(config.features || {}).join(', ')}`);
  }
  const yamlPath = config._path;
  let content = fs.readFileSync(yamlPath, 'utf8');

  const regex = /^(\s*active_feature:\s*)\S+/m;
  if (regex.test(content)) {
    content = content.replace(regex, `$1${featureName}`);
  } else {
    error('active_feature field not found in defaults');
  }

  fs.writeFileSync(yamlPath, content, 'utf8');
  return { active_feature: featureName };
}

function handleState(subcommand, args) {
  const config = loadConfig();
  if (subcommand === 'get') {
    const field = args[0];
    if (!field) {
      const feature = getActiveFeature(config);
      const state = loadState(feature.name);
      output({
        feature: feature.name,
        phase: feature.phase || 'init',
        current_tag: feature.current_tag || null,
        artifacts: state,
      });
    } else if (field === 'phase') {
      output({ phase: getPhase(config) });
    } else if (field === 'tag') {
      const feature = getActiveFeature(config);
      output({ current_tag: feature.current_tag || null });
    } else {
      error(`Unknown state field: ${field}. Use: phase, tag, or omit for full state`);
    }
  } else if (subcommand === 'update') {
    const field = args[0];
    const value = args[1];
    if (!field || !value) error('Usage: state update <field> <value>');
    if (field === 'phase') {
      const result = updatePhase(config, null, value);
      output(result);
    } else {
      error(`Cannot update field '${field}' via CLI. Only 'phase' is supported.`);
    }
  } else {
    error(`Unknown state subcommand: ${subcommand}. Use: get, update`);
  }
}

module.exports = {
  loadState, getPhase, updatePhase, handleState,
  updateFeatureField, switchActiveFeature,
};
