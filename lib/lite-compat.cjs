'use strict';

const fs = require('fs');
const path = require('path');

const { output, error, parseArgs, expandHome } = require('./core.cjs');
const { ensureLiteDirs, loadLiteConfig } = require('./lite-config.cjs');
const { selectedWorktreeIds } = require('./workspace-inventory.cjs');
const {
  inferTrackProfile,
  resolveWorkspaceSet,
} = require('./track-resolver.cjs');
const yaml = require('./yaml.cjs');

function quote(value) {
  if (value == null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(String(value));
}

function resolveBuildProfile(config, parsed) {
  const resolvedSet = resolveWorkspaceSet(config, parsed.set || null, { required: false });
  const trackProfile = resolvedSet.value
    ? inferTrackProfile(config, resolvedSet.value, { activeTrack: resolvedSet.value })
    : null;
  const name = parsed.profile || (trackProfile ? trackProfile.build : null) || parsed.set || resolvedSet.value;
  if (!name) error('No build profile specified. Pass --profile <name> or set defaults.workspace_set.');
  const profile = config.build_profiles[name];
  if (!profile) {
    error(`Unknown build profile '${name}'. Available: ${Object.keys(config.build_profiles).join(', ') || '(none)'}`);
  }
  return { name, profile };
}

function imageRef(profile, env) {
  const registry = profile.registry || (env && env.registry) || null;
  const image = profile.image || 'llm-d-cuda';
  const tag = profile.tag || profile.current_tag || 'manual';
  return registry ? `${registry}/${image}:${tag}` : `${image}:${tag}`;
}

function readLegacyDevYaml(filePath) {
  if (!filePath) return {};
  const absolute = path.resolve(expandHome(filePath));
  if (!fs.existsSync(absolute)) {
    error(`Legacy .dev.yaml not found: ${absolute}`);
  }
  try {
    return yaml.parse(fs.readFileSync(absolute, 'utf8')) || {};
  } catch (err) {
    error(`Failed to parse legacy .dev.yaml '${absolute}': ${err.message}`);
  }
}

function historyFromLegacy(legacy, projectName) {
  const project = legacy &&
    legacy.projects &&
    legacy.projects[projectName] &&
    typeof legacy.projects[projectName] === 'object'
    ? legacy.projects[projectName]
    : null;
  if (!project) return null;
  return Array.isArray(project.build_history) ? project.build_history : null;
}

function currentTagFromLegacy(legacy, projectName) {
  const project = legacy &&
    legacy.projects &&
    legacy.projects[projectName] &&
    typeof legacy.projects[projectName] === 'object'
    ? legacy.projects[projectName]
    : null;
  return project && project.current_tag ? String(project.current_tag) : null;
}

function normalizeHistory(profile, env, legacyHistory, legacyCurrentTag) {
  if (legacyHistory && legacyHistory.length > 0) return legacyHistory;
  if (Array.isArray(profile.history) && profile.history.length > 0) return profile.history;
  const tag = legacyCurrentTag || profile.current_tag || profile.tag || null;
  if (!tag) return [];
  return [{
    tag,
    image: imageRef({ ...profile, tag }, env),
  }];
}

function projectRepos(config, setName) {
  const repos = {};
  for (const id of selectedWorktreeIds(config, setName)) {
    const worktree = config.worktrees[id];
    if (!worktree) continue;
    repos[worktree.repo] = {
      dev_worktree: worktree.path,
    };
  }
  return repos;
}

function buildCompatModel(config, options = {}) {
  const { name: profileName, profile } = resolveBuildProfile(config, {
    profile: options.profile || null,
    set: options.set || null,
  });
  const activeProject = resolveWorkspaceSet(config, options.set || profile.workspace_set || null, { required: false }).value || profile.workspace_set || profileName;
  const deployFlow = config.deploy_flows[activeProject] || {};
  const activeCluster = options.deploy || deployFlow.profile || config.defaults.deploy || null;
  const envName = profile.env || config.defaults.env || config.defaults.sync || null;
  const env = envName ? config.env_profiles[envName] || null : null;
  if (!env) {
    error(`Build profile '${profileName}' does not resolve to a valid env profile.`);
  }

  const legacy = readLegacyDevYaml(options.legacyDevYaml || null);
  const projects = {};
  for (const [name, buildProfile] of Object.entries(config.build_profiles)) {
    const setName = buildProfile.workspace_set || name;
    if (!config.workspace_sets[setName]) continue;
    const buildEnvName = buildProfile.env || envName;
    const buildEnv = buildEnvName ? config.env_profiles[buildEnvName] || env : env;
    const legacyHistory = historyFromLegacy(legacy, setName);
    const legacyCurrentTag = currentTagFromLegacy(legacy, setName);
    projects[setName] = {
      repos: projectRepos(config, setName),
      image_name: buildProfile.image || 'llm-d-cuda',
      current_tag: legacyCurrentTag || buildProfile.current_tag || buildProfile.tag || null,
      build_history: normalizeHistory(buildProfile, buildEnv, legacyHistory, legacyCurrentTag),
    };
  }

  const clusters = {};
  for (const [name, deployProfile] of Object.entries(config.deploy_profiles)) {
    const envProfile = deployProfile.env ? config.env_profiles[deployProfile.env] || {} : {};
    clusters[name] = {
      namespace: deployProfile.namespace || envProfile.namespace || null,
      ssh: envProfile.ssh || null,
    };
  }

  return {
    active_project: activeProject,
    active_cluster: activeCluster,
    build_profile: profileName,
    build_server: {
      ssh: env.ssh || null,
      work_dir: env.work_dir || null,
      registry: profile.registry || env.registry || null,
    },
    clusters,
    projects,
  };
}

function renderMap(lines, indent, map) {
  for (const [key, value] of Object.entries(map || {})) {
    lines.push(`${indent}${key}: ${quote(value)}`);
  }
}

function renderHistory(lines, indent, history) {
  if (!Array.isArray(history) || history.length === 0) {
    lines.push(`${indent}build_history: []`);
    return;
  }
  lines.push(`${indent}build_history:`);
  for (const entry of history) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const entries = Object.entries(entry);
    if (entries.length === 0) {
      lines.push(`${indent}  - {}`);
      continue;
    }
    const [firstKey, firstValue] = entries[0];
    lines.push(`${indent}  - ${firstKey}: ${quote(firstValue)}`);
    for (const [key, value] of entries.slice(1)) {
      lines.push(`${indent}    ${key}: ${quote(value)}`);
    }
  }
}

function renderLegacyDevYaml(model) {
  const lines = [];
  lines.push('# .dev.yaml - generated compatibility file for legacy build.sh');
  lines.push('# Source of truth: .devteam/config.yaml');
  lines.push('');
  lines.push('defaults:');
  lines.push(`  active_project: ${quote(model.active_project)}`);
  lines.push(`  active_cluster: ${quote(model.active_cluster)}`);
  lines.push('');
  lines.push('build_server:');
  renderMap(lines, '  ', model.build_server);
  lines.push('');
  lines.push('clusters:');
  for (const [name, cluster] of Object.entries(model.clusters)) {
    lines.push(`  ${name}:`);
    renderMap(lines, '    ', cluster);
  }
  lines.push('');
  lines.push('projects:');
  for (const [name, project] of Object.entries(model.projects)) {
    lines.push(`  ${name}:`);
    lines.push('    repos:');
    for (const [repoName, repo] of Object.entries(project.repos || {})) {
      lines.push(`      ${repoName}:`);
      renderMap(lines, '        ', repo);
    }
    lines.push(`    image_name: ${quote(project.image_name)}`);
    lines.push(`    current_tag: ${quote(project.current_tag)}`);
    renderHistory(lines, '    ', project.build_history);
  }
  lines.push('');
  return lines.join('\n');
}

function devYamlPath(root) {
  return path.join(root, '.dev.yaml');
}

function generateCompat(options = {}) {
  const config = loadLiteConfig(options.root || null);
  const model = buildCompatModel(config, options);
  const targetPath = devYamlPath(config.root);
  const content = renderLegacyDevYaml(model);
  const exists = fs.existsSync(targetPath);
  const apply = options.apply === true;
  const force = options.force === true;

  if (apply) {
    if (exists && !force) {
      error(`${targetPath} already exists. Pass --force to overwrite after reviewing build_history/current_tag.`);
    }
    ensureLiteDirs(config.root);
    fs.writeFileSync(targetPath, content, 'utf8');
  }

  return {
    action: 'lite_compat',
    applied: apply,
    path: targetPath,
    exists,
    active_project: model.active_project,
    active_cluster: model.active_cluster,
    build_profile: model.build_profile,
    projects: Object.keys(model.projects),
    build_server: model.build_server,
    next_action: apply
      ? 'Run sync apply --include-assets so .dev.yaml is present on the remote build server.'
      : 'Review the generated compatibility plan, then rerun with --apply to write .dev.yaml.',
  };
}

function handleLiteCompat(args) {
  const parsed = parseArgs(args || []);
  output(generateCompat({
    root: parsed.root || null,
    profile: parsed.profile || null,
    set: parsed.set || null,
    deploy: parsed.deploy || null,
    legacyDevYaml: parsed['legacy-dev-yaml'] || null,
    apply: parsed.apply === true,
    force: parsed.force === true,
  }));
}

module.exports = {
  buildCompatModel,
  generateCompat,
  handleLiteCompat,
  renderLegacyDevYaml,
};
