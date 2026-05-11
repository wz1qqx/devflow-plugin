'use strict';

const fs = require('fs');
const path = require('path');

const { output, error, parseArgs, expandHome } = require('./core.cjs');
const { loadConfig } = require('./config.cjs');
const { ensureLiteDirs, configPath } = require('./lite-config.cjs');

function quote(value) {
  if (value == null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(String(value));
}

function scalarList(values) {
  return `[${values.map(quote).join(', ')}]`;
}

function parseSshHost(sshCommand) {
  if (!sshCommand) return null;
  const parts = String(sshCommand).trim().split(/\s+/);
  return parts[parts.length - 1] || null;
}

function featureBaseRefs(config) {
  const refs = {};
  for (const [featureName, feature] of Object.entries(config.features || {})) {
    for (const [repoName, scope] of Object.entries(feature.scope || {})) {
      if (!scope || !scope.dev_slot) continue;
      refs[`${repoName}__${scope.dev_slot}`] = scope.base_ref || null;
      refs[`${repoName}__${scope.dev_slot}__feature`] = featureName;
    }
  }
  return refs;
}

function collectWorkspaceSets(config) {
  const sets = {};
  for (const [featureName, feature] of Object.entries(config.features || {})) {
    const ids = [];
    for (const [repoName, scope] of Object.entries(feature.scope || {})) {
      if (!scope || !scope.dev_slot) continue;
      ids.push(`${repoName}__${scope.dev_slot}`);
    }
    sets[featureName] = {
      description: feature.description || '',
      worktrees: ids,
    };
  }
  return sets;
}

function collectWorktrees(config, oldRoot, buildProfileName) {
  const refs = featureBaseRefs(config);
  const worktrees = {};

  for (const [repoName, repo] of Object.entries(config.repos || {})) {
    for (const [slotName, slot] of Object.entries(repo.dev_slots || {})) {
      const id = `${repoName}__${slotName}`;
      const relativePath = slot.worktree || slot.path || id;
      const sourcePath = path.resolve(oldRoot, relativePath);
      worktrees[id] = {
        id,
        repo: repoName,
        path: relativePath,
        source_path: sourcePath,
        base_ref: refs[id] || slot.baseline_ref || slot.baseline_id || null,
        roles: ['source'],
        sync_profile: buildProfileName,
        remote_path: config.build_server && config.build_server.work_dir
          ? `${String(config.build_server.work_dir).replace(/\/+$/, '')}/${relativePath}`
          : null,
      };
    }
  }

  return worktrees;
}

function collectLearnedRules(config) {
  const rules = [];
  for (const [featureName, feature] of Object.entries(config.features || {})) {
    const learned = feature.hooks && Array.isArray(feature.hooks.learned)
      ? feature.hooks.learned
      : [];
    for (const item of learned) {
      if (!item || typeof item !== 'object') continue;
      rules.push({
        feature: featureName,
        name: item.name || 'unnamed',
        trigger: item.trigger || '',
        added: item.added || '',
        rule: item.rule || item.command || '',
      });
    }
  }
  return rules;
}

function parseImageRef(imageRef) {
  if (!imageRef || typeof imageRef !== 'string') return {};
  const slash = imageRef.lastIndexOf('/');
  const colon = imageRef.lastIndexOf(':');
  if (colon === -1 || colon < slash) return { image: imageRef };
  const namePart = imageRef.slice(slash + 1, colon);
  const registry = slash === -1 ? null : imageRef.slice(0, slash);
  return {
    registry,
    image: namePart,
    tag: imageRef.slice(colon + 1),
  };
}

function collectBuildProfiles(config, buildProfileName) {
  const profiles = {};
  for (const [featureName, feature] of Object.entries(config.features || {})) {
    const imageInfo = parseImageRef(
      config.images &&
      config.images[featureName] &&
      config.images[featureName].current
    );
    const build = feature.build || {};
    const commands = build.commands || {};
    profiles[featureName] = {
      workspace_set: featureName,
      env: buildProfileName,
      registry: (build.env && build.env.REGISTRY) || imageInfo.registry || (config.build_server && config.build_server.registry) || null,
      image: build.image_name || imageInfo.image || 'llm-d-cuda',
      tag: (build.env && build.env.TAG) || feature.current_tag || imageInfo.tag || 'manual',
      command: normalizeBuildCommand(commands.default || null),
      notes: feature.description || null,
    };
  }
  return profiles;
}

function normalizeBuildCommand(command) {
  if (!command) return null;
  const text = String(command).trim();
  if (text === 'bash build.sh' || text === './build.sh' || text === 'sh build.sh') {
    return `${text} --build-only`;
  }
  return command;
}

function collectDeployFlows(config) {
  const flows = {};
  for (const [featureName, feature] of Object.entries(config.features || {})) {
    const deploy = feature.deploy || {};
    flows[featureName] = {
      profile: feature.cluster || (config.defaults && config.defaults.active_cluster) || null,
      commands: deploy.commands || {},
      guide: deploy.guide || null,
      gateway_recipe: deploy.gateway_recipe || null,
    };
  }
  return flows;
}

function renderLiteConfig(model) {
  const lines = [];
  lines.push('version: 1');
  lines.push(`workspace: ${quote(model.workspace)}`);
  lines.push('');
  lines.push('defaults:');
  lines.push(`  workspace_set: ${quote(model.defaults.workspace_set)}`);
  lines.push(`  env: ${quote(model.defaults.env)}`);
  lines.push(`  sync: ${quote(model.defaults.sync)}`);
  lines.push(`  deploy: ${quote(model.defaults.deploy)}`);
  lines.push('');
  lines.push('repos:');
  for (const [name, repo] of Object.entries(model.repos)) {
    lines.push(`  ${name}:`);
    lines.push(`    remote: ${quote(repo.remote)}`);
  }
  lines.push('');
  lines.push('worktrees:');
  for (const [id, worktree] of Object.entries(model.worktrees)) {
    lines.push(`  ${id}:`);
    lines.push(`    repo: ${quote(worktree.repo)}`);
    lines.push(`    path: ${quote(worktree.path)}`);
    lines.push(`    source_path: ${quote(worktree.source_path)}`);
    lines.push(`    base_ref: ${quote(worktree.base_ref)}`);
    lines.push(`    roles: ${scalarList(worktree.roles)}`);
    lines.push('    sync:');
    lines.push(`      profile: ${quote(worktree.sync_profile)}`);
    lines.push(`      remote_path: ${quote(worktree.remote_path)}`);
    lines.push('      strategy: rsync');
  }
  lines.push('');
  lines.push('workspace_sets:');
  for (const [name, set] of Object.entries(model.workspace_sets)) {
    lines.push(`  ${name}:`);
    lines.push(`    description: ${quote(set.description)}`);
    lines.push(`    worktrees: ${scalarList(set.worktrees)}`);
  }
  lines.push('');
  lines.push('env_profiles:');
  for (const [name, profile] of Object.entries(model.env_profiles)) {
    lines.push(`  ${name}:`);
    lines.push(`    type: ${quote(profile.type)}`);
    if (profile.ssh) lines.push(`    ssh: ${quote(profile.ssh)}`);
    if (profile.host) lines.push(`    host: ${quote(profile.host)}`);
    if (profile.work_dir) lines.push(`    work_dir: ${quote(profile.work_dir)}`);
    if (profile.registry) lines.push(`    registry: ${quote(profile.registry)}`);
    if (profile.namespace) lines.push(`    namespace: ${quote(profile.namespace)}`);
    lines.push('    strategy: rsync');
    lines.push('    exclude: [".git/", "__pycache__/", ".venv/", "node_modules/", "build/", "dist/"]');
  }
  lines.push('');
  lines.push('deploy_profiles:');
  for (const [name, profile] of Object.entries(model.deploy_profiles)) {
    lines.push(`  ${name}:`);
    lines.push(`    type: ${quote(profile.type)}`);
    lines.push(`    env: ${quote(profile.env)}`);
    lines.push(`    namespace: ${quote(profile.namespace)}`);
  }
  lines.push('');
  lines.push('build_profiles:');
  for (const [name, profile] of Object.entries(model.build_profiles)) {
    lines.push(`  ${name}:`);
    lines.push(`    workspace_set: ${quote(profile.workspace_set)}`);
    lines.push(`    env: ${quote(profile.env)}`);
    lines.push(`    registry: ${quote(profile.registry)}`);
    lines.push(`    image: ${quote(profile.image)}`);
    lines.push(`    tag: ${quote(profile.tag)}`);
    lines.push(`    command: ${quote(profile.command)}`);
    lines.push(`    notes: ${quote(profile.notes)}`);
  }
  lines.push('');
  lines.push('deploy_flows:');
  for (const [name, flow] of Object.entries(model.deploy_flows)) {
    lines.push(`  ${name}:`);
    lines.push(`    profile: ${quote(flow.profile)}`);
    lines.push(`    guide: ${quote(flow.guide)}`);
    lines.push(`    gateway_recipe: ${quote(flow.gateway_recipe)}`);
    lines.push('    commands:');
    for (const [commandName, command] of Object.entries(flow.commands || {})) {
      lines.push(`      ${commandName}: ${quote(command)}`);
    }
  }
  lines.push('');
  lines.push('knowledge:');
  lines.push(`  vault: ${quote(model.knowledge.vault)}`);
  lines.push(`  wiki_dir: ${quote(model.knowledge.wiki_dir)}`);
  lines.push('  recipes_dir: ".devteam/knowledge/recipes"');
  lines.push('');
  return lines.join('\n');
}

function renderLearnedRules(rules) {
  const lines = [
    '# Migrated Devteam Learnings',
    '',
    'These rules were migrated from legacy feature `hooks.learned` entries. Promote the high-value ones into executable recipes over time.',
    '',
  ];
  for (const rule of rules) {
    lines.push(`## ${rule.name}`);
    lines.push('');
    lines.push(`- Feature: ${rule.feature}`);
    lines.push(`- Trigger: ${rule.trigger || 'unknown'}`);
    if (rule.added) lines.push(`- Added: ${rule.added}`);
    lines.push(`- Rule: ${rule.rule}`);
    lines.push('');
  }
  return lines.join('\n');
}

function buildLiteModel(config, oldRoot, newRoot) {
  const buildProfileName = 'build-server';
  const activeCluster = config.defaults && config.defaults.active_cluster
    ? config.defaults.active_cluster
    : null;
  const featureNames = config.defaults && Array.isArray(config.defaults.features)
    ? config.defaults.features
    : Object.keys(config.features || {});
  const firstFeature = featureNames[0] || null;

  const envProfiles = {};
  if (config.build_server && config.build_server.ssh) {
    envProfiles[buildProfileName] = {
      type: 'remote_dev',
      ssh: config.build_server.ssh,
      host: parseSshHost(config.build_server.ssh),
      work_dir: config.build_server.work_dir || null,
      registry: config.build_server.registry || null,
    };
  }
  for (const [name, cluster] of Object.entries(config.clusters || {})) {
    envProfiles[name] = {
      type: 'k8s',
      ssh: cluster.ssh || null,
      host: parseSshHost(cluster.ssh || ''),
      namespace: cluster.namespace || null,
    };
  }

  const deployProfiles = {};
  for (const [name, cluster] of Object.entries(config.clusters || {})) {
    deployProfiles[name] = {
      type: 'k8s',
      env: name,
      namespace: cluster.namespace || null,
    };
  }

  const repos = {};
  for (const [name, repo] of Object.entries(config.repos || {})) {
    repos[name] = {
      remote: (repo.remotes && (repo.remotes.official || repo.remotes.corp || repo.remotes.personal)) || repo.upstream || null,
    };
  }

  return {
    workspace: newRoot,
    defaults: {
      workspace_set: firstFeature,
      env: buildProfileName,
      sync: buildProfileName,
      deploy: activeCluster,
    },
    repos,
    worktrees: collectWorktrees(config, oldRoot, buildProfileName),
    workspace_sets: collectWorkspaceSets(config),
    env_profiles: envProfiles,
    deploy_profiles: deployProfiles,
    build_profiles: collectBuildProfiles(config, buildProfileName),
    deploy_flows: collectDeployFlows(config),
    knowledge: {
      vault: config.vault || null,
      wiki_dir: config.vault ? path.join(config.vault, 'wiki') : null,
    },
  };
}

function migrateLite(args) {
  const parsed = parseArgs(args || []);
  const oldRoot = parsed.from ? path.resolve(expandHome(parsed.from)) : null;
  const newRoot = parsed.to ? path.resolve(expandHome(parsed.to)) : process.cwd();
  if (!oldRoot) error('Usage: lite migrate --from <legacy-workspace> [--to <new-workspace>] [--force]');
  if (oldRoot === newRoot) {
    error('Refusing to migrate in-place. Choose a different --to workspace so the legacy workspace is not modified.');
  }

  const outPath = configPath(newRoot);
  if (fs.existsSync(outPath) && !parsed.force) {
    error(`${outPath} already exists. Pass --force to overwrite.`);
  }

  const legacyConfig = loadConfig(oldRoot);
  const model = buildLiteModel(legacyConfig, oldRoot, newRoot);
  ensureLiteDirs(newRoot);
  fs.writeFileSync(outPath, renderLiteConfig(model), 'utf8');

  const rules = collectLearnedRules(legacyConfig);
  const rulesPath = path.join(newRoot, '.devteam', 'knowledge', 'recipes', 'legacy-learnings.md');
  fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
  fs.writeFileSync(rulesPath, renderLearnedRules(rules), 'utf8');

  const readmePath = path.join(newRoot, '.devteam', 'README.md');
  fs.writeFileSync(readmePath, [
    '# Devteam Lite Workspace',
    '',
    'This workspace uses the lighter local -> remote -> image -> k8s validation model.',
    '',
    'Useful commands:',
    '',
    '- `node /Users/ppio-dn-289/Documents/devteam/lib/devteam.cjs ws status --root .`',
    '- `node /Users/ppio-dn-289/Documents/devteam/lib/devteam.cjs env doctor --root . --profile build-server`',
    '- `node /Users/ppio-dn-289/Documents/devteam/lib/devteam.cjs sync plan --root . --set <workspace-set>`',
    '- `node /Users/ppio-dn-289/Documents/devteam/lib/devteam.cjs doctor --root .`',
    '',
  ].join('\n'), 'utf8');

  output({
    action: 'lite_migrate',
    from: oldRoot,
    to: newRoot,
    config_path: outPath,
    recipes_path: rulesPath,
    workspace_sets: Object.keys(model.workspace_sets),
    worktrees: Object.keys(model.worktrees).length,
    env_profiles: Object.keys(model.env_profiles),
  });
}

function collectAssetEntries(oldRoot, newRoot) {
  const names = fs.existsSync(oldRoot) ? fs.readdirSync(oldRoot) : [];
  const entries = [];
  const explicit = new Set(['build.sh', 'scripts', 'deploy', 'docs', 'guides', 'hooks']);

  for (const name of names) {
    if (explicit.has(name) || /^Dockerfile(\.|$)/.test(name)) {
      const source = path.join(oldRoot, name);
      const target = path.join(newRoot, name);
      entries.push({
        name,
        source,
        target,
        type: fs.statSync(source).isDirectory() ? 'directory' : 'file',
        exists: fs.existsSync(target),
      });
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function migrateAssets(args) {
  const parsed = parseArgs(args || []);
  const oldRoot = parsed.from ? path.resolve(expandHome(parsed.from)) : null;
  const newRoot = parsed.to ? path.resolve(expandHome(parsed.to)) : process.cwd();
  if (!oldRoot) error('Usage: lite assets --from <legacy-workspace> [--to <new-workspace>] [--apply] [--force]');
  if (oldRoot === newRoot) {
    error('Refusing to copy assets in-place. Choose a different --to workspace so the legacy workspace is not modified.');
  }

  const apply = parsed.apply === true;
  const force = parsed.force === true;
  const entries = collectAssetEntries(oldRoot, newRoot).map(entry => {
    if (entry.exists && !force) {
      return { ...entry, action: 'skip', reason: 'target exists' };
    }
    if (!apply) {
      return { ...entry, action: 'copy_plan' };
    }

    fs.mkdirSync(path.dirname(entry.target), { recursive: true });
    if (entry.exists && force) {
      fs.rmSync(entry.target, { recursive: true, force: true });
    }
    fs.cpSync(entry.source, entry.target, { recursive: true });
    return { ...entry, action: 'copied' };
  });

  output({
    action: 'lite_assets',
    from: oldRoot,
    to: newRoot,
    applied: apply,
    totals: {
      entries: entries.length,
      copy_plan: entries.filter(entry => entry.action === 'copy_plan').length,
      copied: entries.filter(entry => entry.action === 'copied').length,
      skipped: entries.filter(entry => entry.action === 'skip').length,
    },
    entries,
  });
}

function handleLite(subcommand, args) {
  if (subcommand === 'migrate') {
    migrateLite(args);
    return;
  }
  if (subcommand === 'assets') {
    migrateAssets(args);
    return;
  }
  if (subcommand === 'compat') {
    const { handleLiteCompat } = require('./lite-compat.cjs');
    handleLiteCompat(args);
    return;
  }
  error(`Unknown lite subcommand: '${subcommand}'. Use: migrate, assets, compat`);
}

module.exports = {
  buildLiteModel,
  handleLite,
  migrateAssets,
  migrateLite,
  renderLiteConfig,
};
