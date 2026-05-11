'use strict';

const { error } = require('./core.cjs');

function firstEntry(map, predicate) {
  for (const [name, value] of Object.entries(map || {})) {
    if (predicate(name, value || {})) return { name, value: value || {} };
  }
  return null;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function workspaceSetEnv() {
  return process.env.DEVTEAM_TRACK || process.env.DEVTEAM_WORKSPACE_SET || null;
}

function normalizeTrackToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function compactTrackToken(value) {
  return normalizeTrackToken(value).replace(/[^a-z0-9]/g, '');
}

function trackAliases(config, trackName) {
  const entry = (config.workspace_sets || {})[trackName] || {};
  return unique([
    trackName,
    ...(Array.isArray(entry.aliases) ? entry.aliases : []),
  ]).map(value => String(value));
}

function aliasTokens(alias) {
  const normalized = normalizeTrackToken(alias);
  const compact = compactTrackToken(alias);
  const tokens = [normalized, compact];
  if (/^v\d+$/.test(compact)) tokens.push(compact.slice(1));
  return unique(tokens);
}

function candidateTracks(config, value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const normalized = normalizeTrackToken(raw);
  const compact = compactTrackToken(raw);
  const exact = [];
  const aliasExact = [];
  const fuzzy = [];

  for (const name of Object.keys(config.workspace_sets || {})) {
    const aliases = trackAliases(config, name);
    const normalizedAliases = aliases.map(alias => normalizeTrackToken(alias));
    const compactAliases = aliases.map(alias => compactTrackToken(alias));
    const exactAliasTokens = unique(aliases.flatMap(alias => aliasTokens(alias)));
    if (name === raw || normalizeTrackToken(name) === normalized) {
      exact.push(name);
      continue;
    }
    if (exactAliasTokens.includes(normalized) || exactAliasTokens.includes(compact)) {
      aliasExact.push(name);
      continue;
    }
    if (
      normalizedAliases.some(alias => alias.includes(normalized) || normalized.includes(alias)) ||
      compactAliases.some(alias => alias.includes(compact) || compact.includes(alias))
    ) {
      fuzzy.push(name);
    }
  }

  if (exact.length) return unique(exact);
  if (aliasExact.length) return unique(aliasExact);
  return unique(fuzzy);
}

function resolveTrackName(config, value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const matches = candidateTracks(config, raw);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    error(`Ambiguous track '${raw}'. Matches: ${matches.join(', ')}`);
  }
  error(`Unknown track '${raw}'. Available: ${Object.keys(config.workspace_sets).join(', ') || '(none)'}`);
}

function sameTrack(config, left, right) {
  try {
    return resolveTrackName(config, left) === resolveTrackName(config, right);
  } catch (_) {
    return false;
  }
}

function resolveWorkspaceSet(config, explicitValue, options = {}) {
  const useDefault = options.default !== false;
  const rawValue = explicitValue ||
    workspaceSetEnv() ||
    (useDefault && config.defaults ? config.defaults.workspace_set : null) ||
    null;
  const source = explicitValue
    ? 'explicit'
    : (workspaceSetEnv()
      ? 'env'
      : (useDefault && config.defaults && config.defaults.workspace_set ? 'default' : 'none'));
  if (!rawValue) {
    if (options.required === true) {
      error(`${options.label || 'workspace set'} requires --set <track>, DEVTEAM_TRACK, or defaults.workspace_set.`);
    }
    return { value: null, source };
  }
  const value = resolveTrackName(config, rawValue);
  return {
    value,
    source,
    input: String(rawValue),
    resolved: value,
    alias: String(rawValue) !== value,
  };
}

function worktreesForTrack(config, track) {
  const resolvedTrack = resolveTrackName(config, track);
  const set = config.workspace_sets[resolvedTrack];
  if (!set) {
    error(`Unknown track '${track}'. Available: ${Object.keys(config.workspace_sets).join(', ') || '(none)'}`);
  }
  return (set.worktrees || []).map(id => config.worktrees[id]).filter(Boolean);
}

function findBuildProfile(config, track) {
  if (config.build_profiles[track]) return track;
  const exact = `${track}-image`;
  if (config.build_profiles[exact]) return exact;
  const found = firstEntry(config.build_profiles, (_name, profile) => profile.workspace_set === track);
  return found ? found.name : null;
}

function findValidationProfile(config, track) {
  const exact = `${track}-remote-venv`;
  if (config.validation_profiles[exact]) return exact;
  const found = firstEntry(config.validation_profiles, (_name, profile) => profile.workspace_set === track);
  return found ? found.name : null;
}

function findDeployFlow(config, track) {
  const exact = `${track}-preprod`;
  if (config.deploy_flows[exact]) return exact;
  const found = firstEntry(config.deploy_flows, (name, flow) => (
    flow.workspace_set === track ||
    flow.track === track ||
    name === track ||
    name.startsWith(`${track}-`)
  ));
  return found ? found.name : null;
}

function inferTrackProfile(config, track, options = {}) {
  const resolvedTrack = resolveTrackName(config, track);
  const set = config.workspace_sets[resolvedTrack];
  if (!set) {
    error(`Unknown track '${track}'. Available: ${Object.keys(config.workspace_sets).join(', ') || '(none)'}`);
  }

  const activeTrack = options.activeTrack || (config.defaults ? config.defaults.workspace_set : null);
  const worktrees = worktreesForTrack(config, resolvedTrack);
  const validationName = findValidationProfile(config, resolvedTrack);
  const validation = validationName ? (config.validation_profiles[validationName] || {}) : null;
  const buildName = findBuildProfile(config, resolvedTrack);
  const deployFlowName = findDeployFlow(config, resolvedTrack);
  const deployFlow = deployFlowName ? (config.deploy_flows[deployFlowName] || {}) : null;
  const preferredEnv = validation && validation.env ? String(validation.env) : null;
  const remoteTestEnv = config.env_profiles[`remote-test-${resolvedTrack}`] ? `remote-test-${resolvedTrack}` : null;
  const syncProfiles = unique(worktrees.map(item => item.sync && item.sync.profile));
  const env = preferredEnv || remoteTestEnv || syncProfiles[0] || (config.defaults ? config.defaults.env : null) || null;
  const sync = syncProfiles.length === 1 ? syncProfiles[0] : (remoteTestEnv || env || (config.defaults ? config.defaults.sync : null) || null);

  return {
    name: resolvedTrack,
    description: set.description || '',
    aliases: trackAliases(config, resolvedTrack).filter(alias => alias !== resolvedTrack),
    status: set.status || null,
    active: sameTrack(config, activeTrack || resolvedTrack, resolvedTrack),
    worktrees: worktrees.length,
    repos: unique(worktrees.map(item => item.repo)),
    env,
    sync,
    build: buildName,
    deploy: deployFlow && deployFlow.profile ? String(deployFlow.profile) : null,
    deploy_flow: deployFlowName,
    validation: validationName,
  };
}

module.exports = {
  candidateTracks,
  inferTrackProfile,
  resolveTrackName,
  resolveWorkspaceSet,
  unique,
  worktreesForTrack,
};
