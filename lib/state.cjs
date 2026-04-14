'use strict';

const fs = require('fs');
const path = require('path');
const { output, error, findWorkspaceRoot } = require('./core.cjs');
const { loadConfig, getActiveFeature } = require('./config.cjs');

function loadState(featureName, root) {
  const r = root || findWorkspaceRoot();
  if (!r) error('.dev.yaml not found');
  const devDir = path.join(r, '.dev');
  const state = { specs: [], plans: [], reviews: [] };

  // Check per-feature artifacts (current schema: .dev/features/<name>/)
  if (featureName) {
    const featureDir = path.join(devDir, 'features', featureName);
    if (fs.existsSync(featureDir)) {
      if (fs.existsSync(path.join(featureDir, 'spec.md'))) state.specs.push(featureName);
      if (fs.existsSync(path.join(featureDir, 'plan.md'))) state.plans.push(featureName);
      if (fs.existsSync(path.join(featureDir, 'review.md'))) state.reviews.push(featureName);
    }
  }

  // Also scan features/ directory for all features
  const featuresDir = path.join(devDir, 'features');
  if (fs.existsSync(featuresDir)) {
    for (const name of fs.readdirSync(featuresDir)) {
      const fDir = path.join(featuresDir, name);
      if (!fs.statSync(fDir).isDirectory()) continue;
      if (fs.existsSync(path.join(fDir, 'spec.md')) && !state.specs.includes(name)) state.specs.push(name);
      if (fs.existsSync(path.join(fDir, 'plan.md')) && !state.plans.includes(name)) state.plans.push(name);
      if (fs.existsSync(path.join(fDir, 'review.md')) && !state.reviews.includes(name)) state.reviews.push(name);
    }
  }
  return state;
}

// TODO: remove after v3 migration period — users may have multiple projects
// that won't all resume on the same day.
const PHASE_MIGRATION = {
  'init':     'spec',
  'discuss':  'spec',
  'exec':     'code',
  'deploy':   'ship',
  'observe':  'ship',
  'rollback': 'ship',
  'build':    'ship',    // old "build" = container build → now "ship"
  'verify':   'test',
};

/**
 * Get phase for a feature. Auto-migrates legacy phase values.
 */
function getPhase(config, featureName) {
  const name = featureName || (config.defaults && config.defaults.active_feature);
  if (!name) error('No feature specified');
  const feature = config.features && config.features[name];
  if (!feature) error(`Feature '${name}' not found`);
  const raw = feature.phase || 'spec';

  // Auto-migrate legacy phases
  if (PHASE_MIGRATION[raw]) {
    const migrated = PHASE_MIGRATION[raw];
    process.stderr.write(`[devflow] Phase '${raw}' migrated to '${migrated}' (v2 pipeline)\n`);
    try { updatePhase(config, name, migrated); } catch (_) { /* best effort */ }
    return migrated;
  }
  return raw;
}

/**
 * Route to the correct file path for feature write ops.
 * Split format: .dev/features/<name>/config.yaml
 * Legacy format: .dev.yaml
 */
function getFeaturePath(config, featureName) {
  if (config._format === 'split') {
    const feat = config.features && config.features[featureName];
    if (!feat || !feat._path) error(`Feature '${featureName}' config.yaml not found. Run /devteam init feature first.`);
    return feat._path;
  }
  return config._path;
}

/**
 * Internal: replace a top-level scalar field in a flat config.yaml.
 * Used for split format where feature config is a flat file (no nesting).
 */
function replaceTopLevelField(content, field, value) {
  const lines = content.split('\n');
  const quoteIfNeeded = v => (typeof v === 'string' && (v.includes(':') || v.includes('#') || v.includes('"'))) ? JSON.stringify(v) : v;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([\w_-]+):\s*(.*)/);
    if (m && m[1] === field) {
      lines[i] = `${field}: ${quoteIfNeeded(value)}`;
      return lines.join('\n');
    }
  }
  error(`Field '${field}' not found in feature config.yaml`);
}

/**
 * Update phase in config file for a feature.
 */
function updatePhase(config, featureName, phase) {
  const validPhases = [
    'spec', 'plan', 'code', 'test', 'review',
    'ship', 'debug', 'dev', 'completed',
  ];
  if (!validPhases.includes(phase)) {
    error(`Invalid phase '${phase}'. Valid: ${validPhases.join(', ')}`);
  }

  const name = featureName || (config.defaults && config.defaults.active_feature);
  if (!name) error('No feature specified for phase update');

  if (config._format === 'split') {
    const featPath = getFeaturePath(config, name);
    let content = fs.readFileSync(featPath, 'utf8');
    content = replaceTopLevelField(content, 'phase', phase);
    fs.writeFileSync(featPath, content, 'utf8');
  } else {
    const yamlPath = config._path;
    let content = fs.readFileSync(yamlPath, 'utf8');
    content = replaceFeatureField(content, name, 'phase', phase);
    fs.writeFileSync(yamlPath, content, 'utf8');
  }
  return { feature: name, phase };
}

/**
 * Update a scalar field within a feature's config.
 */
function updateFeatureField(config, featureName, field, value) {
  if (config._format === 'split') {
    const featPath = getFeaturePath(config, featureName);
    let content = fs.readFileSync(featPath, 'utf8');
    content = replaceTopLevelField(content, field, value);
    fs.writeFileSync(featPath, content, 'utf8');
  } else {
    const yamlPath = config._path;
    let content = fs.readFileSync(yamlPath, 'utf8');
    content = replaceFeatureField(content, featureName, field, value);
    fs.writeFileSync(yamlPath, content, 'utf8');
  }
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

/**
 * Add a feature name to defaults.features list in workspace.yaml (split format only).
 */
function addFeatureName(config, featureName) {
  if (config._format !== 'split') return; // legacy: feature block written directly by agent
  const wsPath = config._ws_path || config._path;
  const lines = fs.readFileSync(wsPath, 'utf8').split('\n');

  // Find 'defaults:' block → find '  features:' within it
  let featListLine = -1;
  let defaultsEnd  = lines.length;
  let inDefaults   = false;

  for (let i = 0; i < lines.length; i++) {
    if (/^defaults:\s*$/.test(lines[i])) { inDefaults = true; continue; }
    if (inDefaults) {
      if (/^  features:\s*$/.test(lines[i])) { featListLine = i; }
      // Stop at next indent-0 non-comment line
      if (/^\w/.test(lines[i]) && !/^#/.test(lines[i])) { defaultsEnd = i; break; }
    }
  }

  if (featListLine === -1) {
    // No features: list yet — insert at defaultsEnd - 1 (end of defaults block)
    const insertAt = defaultsEnd === lines.length ? lines.length : defaultsEnd;
    lines.splice(insertAt, 0, '  features:', `    - ${featureName}`);
  } else {
    // Find end of features list and append
    let listEnd = defaultsEnd;
    for (let i = featListLine + 1; i < defaultsEnd; i++) {
      if (!/^    - /.test(lines[i]) && lines[i].trim() !== '') { listEnd = i; break; }
    }
    lines.splice(listEnd, 0, `    - ${featureName}`);
  }

  fs.writeFileSync(wsPath, lines.join('\n'), 'utf8');
  return { added: featureName };
}

/**
 * Delete a feature from its config file and optionally its .dev/features/<name>/ directory.
 */
function deleteFeature(config, featureName) {
  if (!config.features || !config.features[featureName]) {
    error(`Feature '${featureName}' not found. Available: ${Object.keys(config.features || {}).join(', ')}`);
  }

  if (config._format === 'split') {
    // Split: remove from defaults.features list + delete directory
    const wsPath = config._ws_path || config._path;
    const lines  = fs.readFileSync(wsPath, 'utf8').split('\n');
    const idx    = lines.findIndex(l => l.trim() === `- ${featureName}`);
    if (idx !== -1) lines.splice(idx, 1);
    fs.writeFileSync(wsPath, lines.join('\n'), 'utf8');

    const root       = config._root || findWorkspaceRoot();
    const featureDir = path.join(root, '.dev', 'features', featureName);
    if (fs.existsSync(featureDir)) fs.rmSync(featureDir, { recursive: true, force: true });

    const activeFeature = config.defaults && config.defaults.active_feature;
    if (activeFeature === featureName) {
      const remaining = Object.keys(config.features).filter(n => n !== featureName);
      if (remaining.length > 0) {
        const updatedConfig = require('./config.cjs').loadConfig(root);
        switchActiveFeature(updatedConfig, remaining[0]);
      }
    }
    return { deleted: featureName };
  }

  // Legacy: remove feature block from .dev.yaml
  const yamlPath = config._path;
  const content = fs.readFileSync(yamlPath, 'utf8');
  const lines = content.split('\n');

  // Find the feature block and remove it
  let featureStart = -1;
  let featureEnd = -1;
  let featureIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s+)(\S+):\s*$/);
    if (match && match[2] === featureName) {
      featureStart = i;
      featureIndent = match[1].length;
      break;
    }
  }

  if (featureStart === -1) {
    error(`Feature '${featureName}' block not found in YAML`);
  }

  // Find end of feature block
  for (let i = featureStart + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const lineIndent = (line.match(/^(\s*)/) || ['', ''])[1].length;
    if (lineIndent <= featureIndent) {
      featureEnd = i;
      break;
    }
  }
  if (featureEnd === -1) featureEnd = lines.length;

  const newLines = [...lines.slice(0, featureStart), ...lines.slice(featureEnd)];
  fs.writeFileSync(yamlPath, newLines.join('\n'), 'utf8');

  // Remove .dev/features/<name>/ directory if it exists
  const root = config._root || path.dirname(yamlPath);
  const featureDir = path.join(root, '.dev', 'features', featureName);
  if (fs.existsSync(featureDir)) {
    fs.rmSync(featureDir, { recursive: true, force: true });
  }

  // If this was the active feature, clear it
  const activeFeature = config.defaults && config.defaults.active_feature;
  if (activeFeature === featureName) {
    const remaining = Object.keys(config.features).filter(n => n !== featureName);
    if (remaining.length > 0) {
      // Re-read after deletion and switch to first remaining
      const updatedConfig = require('./config.cjs').loadConfig(root);
      switchActiveFeature(updatedConfig, remaining[0]);
    }
  }

  return { deleted: featureName };
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
    } else if (['feature_stage', 'pipeline_stages', 'completed_stages', 'pipeline_loop_count', 'plan_progress', 'last_activity'].includes(field)) {
      // Update STATE.md frontmatter field
      const { updateStateMd } = require('./session.cjs');
      const feature = getActiveFeature(config);
      const featureName = feature ? feature.name : null;
      const root = config._root || findWorkspaceRoot();
      const result = updateStateMd(root, { frontmatter: { [field]: value } }, featureName);
      output({ field, value, ...result });
    } else {
      error(`Cannot update field '${field}' via CLI. Supported: phase, feature_stage, pipeline_stages, completed_stages, pipeline_loop_count, plan_progress, last_activity`);
    }
  } else {
    error(`Unknown state subcommand: ${subcommand}. Use: get, update`);
  }
}

/**
 * appendBuildHistory for split format: build_history: is at top level of config.yaml.
 * indent=0 for the key, indent=2 for list items, indent=4 for sub-fields.
 */
function appendBuildHistorySplit(config, featureName, entry) {
  const featPath = getFeaturePath(config, featureName);
  let content = fs.readFileSync(featPath, 'utf8');
  const lines = content.split('\n');
  const quoteIfNeeded = v => (v && (v.includes(':') || v.includes('#') || v.includes('"'))) ? JSON.stringify(v) : v;

  // Detect list item indent from existing entries (default: 2 spaces, matching migration output)
  let itemIndent = 2;
  for (const line of lines) {
    const m = line.match(/^(\s+)- tag:/);
    if (m) { itemIndent = m[1].length; break; }
  }
  const p1 = ' '.repeat(itemIndent);
  const p2 = ' '.repeat(itemIndent + 2);

  const newEntry = [
    `${p1}- tag: ${entry.tag}`,
    `${p2}date: ${entry.date}`,
    `${p2}changes: ${quoteIfNeeded(entry.changes)}`,
    `${p2}base: ${quoteIfNeeded(entry.base)}`,
    ...(entry.mode    ? [`${p2}mode: ${entry.mode}`]              : []),
    ...(entry.cluster ? [`${p2}cluster: ${entry.cluster}`]        : []),
    ...(entry.note    ? [`${p2}note: ${quoteIfNeeded(entry.note)}`] : []),
  ];

  // Find top-level build_history: line
  let historyLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^build_history:\s*$/.test(lines[i])) { historyLine = i; break; }
  }

  if (historyLine === -1) {
    lines.push('build_history:');
    lines.push(...newEntry);
  } else {
    // Insert immediately after build_history: → newest first
    lines.splice(historyLine + 1, 0, ...newEntry);
  }

  fs.writeFileSync(featPath, lines.join('\n'), 'utf8');
  return { feature: featureName, tag: entry.tag, appended: true };
}

/**
 * Append a build history entry to a feature's build_history list.
 * Split format: top-level field in .dev/features/<name>/config.yaml
 * Legacy format: nested under features.<name> in .dev.yaml
 */
function appendBuildHistory(config, featureName, entry) {
  if (config._format === 'split') {
    return appendBuildHistorySplit(config, featureName, entry);
  }
  // Legacy path (original implementation below)
  const yamlPath = config._path;
  let content = fs.readFileSync(yamlPath, 'utf8');
  const lines = content.split('\n');

  // Locate feature block
  let featureStart = -1;
  let featureIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s+)(\S+):\s*$/) || lines[i].match(/^(\s+)(\S+):\s/);
    if (m && m[2] === featureName) { featureStart = i; featureIndent = m[1].length; break; }
  }
  if (featureStart === -1) error(`Feature '${featureName}' not found in YAML`);

  // Locate end of feature block
  let featureEnd = lines.length;
  for (let i = featureStart + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const indent = (line.match(/^(\s*)/) || ['', ''])[1].length;
    if (indent <= featureIndent) { featureEnd = i; break; }
  }

  // Locate build_history: line within feature block
  const fieldIndent = featureIndent + 2;
  const itemIndent = featureIndent + 4;
  const subIndent  = featureIndent + 6;
  let historyLine = -1;
  for (let i = featureStart + 1; i < featureEnd; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const indent = (line.match(/^(\s*)/) || ['', ''])[1].length;
    if (indent === fieldIndent && line.trim().startsWith('build_history:')) {
      historyLine = i; break;
    }
  }

  // Build new entry lines
  const p1 = ' '.repeat(itemIndent);
  const p2 = ' '.repeat(subIndent);
  const quoteIfNeeded = v => (v && (v.includes(':') || v.includes('#') || v.includes('"'))) ? JSON.stringify(v) : v;
  const newEntry = [
    `${p1}- tag: ${entry.tag}`,
    `${p2}date: ${entry.date}`,
    `${p2}changes: ${quoteIfNeeded(entry.changes)}`,
    `${p2}base: ${quoteIfNeeded(entry.base)}`,
    ...(entry.mode    ? [`${p2}mode: ${entry.mode}`]              : []),
    ...(entry.cluster ? [`${p2}cluster: ${entry.cluster}`]        : []),
    ...(entry.note    ? [`${p2}note: ${quoteIfNeeded(entry.note)}`] : []),
  ];

  let insertAt;
  if (historyLine === -1) {
    // build_history: key doesn't exist — create it just before featureEnd
    const fp = ' '.repeat(fieldIndent);
    lines.splice(featureEnd, 0, `${fp}build_history:`, ...newEntry);
  } else {
    // Insert immediately after build_history: line → newest entry first
    lines.splice(historyLine + 1, 0, ...newEntry);
  }

  fs.writeFileSync(yamlPath, lines.join('\n'), 'utf8');
  return { feature: featureName, tag: entry.tag, appended: true };
}

/**
 * Write/append one row to .dev/features/<name>/build-manifest.md.
 * This is the permanent, never-truncated build chain record.
 */
function writeBuildManifest(root, featureName, entry) {
  const dir = path.join(root, '.dev', 'features', featureName);
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, 'build-manifest.md');

  const row = `| ${entry.tag} | ${entry.date} | ${entry.base} | ${entry.changes} | ${entry.mode || '-'} | ${entry.cluster || '-'} |`;

  if (!fs.existsSync(manifestPath)) {
    const header = [
      `# Build Manifest: ${featureName}`,
      '',
      '| Tag | Date | Base | Changes | Mode | Cluster |',
      '|-----|------|------|---------|------|---------|',
      row,
      '',
    ].join('\n');
    fs.writeFileSync(manifestPath, header, 'utf8');
  } else {
    const existing = fs.readFileSync(manifestPath, 'utf8');
    fs.writeFileSync(manifestPath, existing.trimEnd() + '\n' + row + '\n', 'utf8');
  }
  return manifestPath;
}

module.exports = {
  loadState, getPhase, updatePhase, handleState,
  updateFeatureField, appendBuildHistory, writeBuildManifest,
  switchActiveFeature, deleteFeature, addFeatureName,
};
