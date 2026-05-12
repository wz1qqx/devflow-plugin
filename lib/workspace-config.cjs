'use strict';

const fs = require('fs');
const path = require('path');

const { error, expandHome } = require('./core.cjs');
const yaml = require('./yaml.cjs');

const WORKSPACE_DIR = '.devteam';
const WORKSPACE_CONFIG = 'config.yaml';

function findWorkspaceConfigRoot(startDir) {
  let dir = startDir || process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, WORKSPACE_DIR, WORKSPACE_CONFIG))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function resolveWorkspaceConfigRoot(rootArg) {
  if (rootArg) {
    const absolute = path.resolve(expandHome(rootArg));
    if (fs.existsSync(path.join(absolute, WORKSPACE_DIR, WORKSPACE_CONFIG))) return absolute;
    error(`.devteam/config.yaml not found under '${absolute}'`);
  }

  const workspaceRoot = findWorkspaceConfigRoot();
  if (workspaceRoot) return workspaceRoot;

  error('.devteam/config.yaml not found');
}

function configPath(root) {
  return path.join(root, WORKSPACE_DIR, WORKSPACE_CONFIG);
}

function normalizeMap(value, label) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    error(`${label} must be a mapping.`);
  }
  return value;
}

function normalizeStringList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    if (text.startsWith('[') && text.endsWith(']')) {
      return text.slice(1, -1).split(',').map(item => item.trim()).filter(Boolean);
    }
    return [text];
  }
  return [];
}

function normalizeBoolean(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (['true', 'yes', '1', 'on'].includes(text)) return true;
    if (['false', 'no', '0', 'off'].includes(text)) return false;
  }
  return fallback;
}

function resolvePath(root, value) {
  if (!value) return null;
  const expanded = expandHome(String(value));
  return path.isAbsolute(expanded) ? expanded : path.resolve(root, expanded);
}

function normalizeWorktree(id, raw, root) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    error(`worktrees.${id} must be a mapping.`);
  }
  if (!raw.repo) error(`worktrees.${id}.repo is required.`);
  if (!raw.path) error(`worktrees.${id}.path is required.`);

  const sync = normalizeMap(raw.sync, `worktrees.${id}.sync`);
  const publish = normalizeMap(raw.publish, `worktrees.${id}.publish`);
  const publishAfterValidation = normalizeBoolean(
    publish.after_validation,
    normalizeBoolean(raw.publish_after_validation, false)
  );
  return {
    id,
    repo: String(raw.repo),
    path: String(raw.path),
    abs_path: resolvePath(root, raw.path),
    source_path: raw.source_path ? String(raw.source_path) : null,
    abs_source_path: resolvePath(root, raw.source_path),
    base_ref: raw.base_ref ? String(raw.base_ref) : null,
    branch: raw.branch ? String(raw.branch) : null,
    roles: normalizeStringList(raw.roles),
    publish_after_validation: publishAfterValidation,
    publish: {
      after_validation: publishAfterValidation,
      remote: publish.remote ? String(publish.remote) : null,
      branch: publish.branch ? String(publish.branch) : null,
      status: publish.status ? String(publish.status) : null,
      notes: publish.notes ? String(publish.notes) : null,
    },
    sync: {
      profile: sync.profile ? String(sync.profile) : null,
      remote_path: sync.remote_path ? String(sync.remote_path) : null,
      strategy: sync.strategy ? String(sync.strategy) : null,
      patch_mode: sync.patch_mode ? String(sync.patch_mode) : null,
      include_paths: normalizeStringList(sync.include_paths),
    },
  };
}

function normalizeWorkspaceConfig(raw, root, cfgPath) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    error('.devteam/config.yaml is invalid.');
  }

  const repos = normalizeMap(raw.repos, 'repos');
  const worktreesRaw = normalizeMap(raw.worktrees, 'worktrees');
  const worktrees = {};
  for (const [id, entry] of Object.entries(worktreesRaw)) {
    worktrees[id] = normalizeWorktree(id, entry, root);
  }

  const workspaceSetsRaw = normalizeMap(raw.workspace_sets, 'workspace_sets');
  const workspaceSets = {};
  for (const [name, entry] of Object.entries(workspaceSetsRaw)) {
    const setEntry = normalizeMap(entry, `workspace_sets.${name}`);
    workspaceSets[name] = {
      description: setEntry.description ? String(setEntry.description) : '',
      aliases: normalizeStringList(setEntry.aliases),
      status: setEntry.status ? String(setEntry.status) : null,
      worktrees: normalizeStringList(setEntry.worktrees),
    };
  }

  const envProfiles = normalizeMap(raw.env_profiles, 'env_profiles');
  const builders = normalizeMap(raw.builders, 'builders');
  const deployProfiles = normalizeMap(raw.deploy_profiles, 'deploy_profiles');
  const buildProfiles = normalizeMap(raw.build_profiles, 'build_profiles');
  const deployFlows = normalizeMap(raw.deploy_flows, 'deploy_flows');
  const validationProfiles = normalizeMap(raw.validation_profiles, 'validation_profiles');
  const serverTestProfiles = normalizeMap(raw.server_test_profiles, 'server_test_profiles');
  const defaults = normalizeMap(raw.defaults, 'defaults');
  const knowledge = normalizeMap(raw.knowledge, 'knowledge');

  return {
    version: raw.version || 1,
    name: raw.name ? String(raw.name) : path.basename(root),
    workspace: raw.workspace ? String(raw.workspace) : root,
    root,
    config_path: cfgPath,
    defaults: {
      workspace_set: defaults.workspace_set ? String(defaults.workspace_set) : null,
      env: defaults.env ? String(defaults.env) : null,
      sync: defaults.sync ? String(defaults.sync) : null,
      deploy: defaults.deploy ? String(defaults.deploy) : null,
      build: defaults.build ? String(defaults.build) : null,
      deploy_flow: defaults.deploy_flow ? String(defaults.deploy_flow) : null,
      validation: defaults.validation ? String(defaults.validation) : null,
      server_test: defaults.server_test ? String(defaults.server_test) : null,
    },
    repos,
    worktrees,
    workspace_sets: workspaceSets,
    env_profiles: envProfiles,
    builders,
    deploy_profiles: deployProfiles,
    build_profiles: buildProfiles,
    deploy_flows: deployFlows,
    validation_profiles: validationProfiles,
    server_test_profiles: serverTestProfiles,
    knowledge,
    agent_onboarding: normalizeMap(raw.agent_onboarding, 'agent_onboarding'),
  };
}

function loadWorkspaceConfig(rootArg) {
  const root = resolveWorkspaceConfigRoot(rootArg);
  const cfgPath = configPath(root);
  let parsed;
  try {
    parsed = yaml.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (err) {
    error(`Failed to parse ${cfgPath}: ${err.message}`);
  }
  return normalizeWorkspaceConfig(parsed, root, cfgPath);
}

function ensureWorkspaceDirs(root) {
  fs.mkdirSync(path.join(root, WORKSPACE_DIR), { recursive: true });
  fs.mkdirSync(path.join(root, WORKSPACE_DIR, 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, WORKSPACE_DIR, 'profiles'), { recursive: true });
  fs.mkdirSync(path.join(root, WORKSPACE_DIR, 'flows'), { recursive: true });
  fs.mkdirSync(path.join(root, WORKSPACE_DIR, 'recipes'), { recursive: true });
  fs.mkdirSync(path.join(root, WORKSPACE_DIR, 'wiki'), { recursive: true });
  fs.mkdirSync(path.join(root, WORKSPACE_DIR, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, WORKSPACE_DIR, 'runs'), { recursive: true });
}

module.exports = {
  WORKSPACE_DIR,
  WORKSPACE_CONFIG,
  configPath,
  ensureWorkspaceDirs,
  findWorkspaceConfigRoot,
  loadWorkspaceConfig,
  normalizeStringList,
  resolvePath,
};
