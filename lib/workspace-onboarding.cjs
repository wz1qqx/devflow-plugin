'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { output, error, parseArgs } = require('./core.cjs');
const { loadWorkspaceConfig } = require('./workspace-config.cjs');
const { skillList } = require('./skill-manager.cjs');
const { listTracks, trackStatus } = require('./track-profile.cjs');
const { resolveWorkspaceSet } = require('./track-resolver.cjs');

function shortPath(value) {
  const text = String(value || '');
  if (!text) return '';
  const home = os.homedir();
  return text.startsWith(home) ? `~${text.slice(home.length)}` : text;
}

function shellArg(value) {
  return JSON.stringify(String(value));
}

function devteamCliPath() {
  return path.join(__dirname, 'devteam.cjs');
}

function command(parts) {
  return [
    'node',
    shellArg(devteamCliPath()),
    ...parts,
  ].join(' ');
}

function templatePath(name) {
  return path.resolve(__dirname, '..', 'templates', 'onboarding', name);
}

function readTemplate(name) {
  const filePath = templatePath(name);
  if (!fs.existsSync(filePath)) {
    error(`onboarding template not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function renderTemplate(name, vars) {
  return readTemplate(name).replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key) => (
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : ''
  ));
}

function configuredOldWorkspace(config) {
  const agent = config.agent_onboarding || {};
  const old = agent.old_workspace || null;
  if (!old) return null;
  if (typeof old === 'string') {
    return { path: old, policy: 'read-only' };
  }
  if (typeof old === 'object' && !Array.isArray(old) && old.path) {
    return {
      path: String(old.path),
      policy: old.policy ? String(old.policy) : 'read-only',
    };
  }
  return null;
}

function oldWorkspaceBlock(config) {
  const old = configuredOldWorkspace(config);
  if (!old) {
    return 'Do not modify directories outside this workspace unless the user explicitly asks.';
  }
  return [
    'Do not modify the old/reference workspace unless the user explicitly asks:',
    '',
    '```text',
    old.path,
    '```',
    '',
    `Policy: ${old.policy}.`,
  ].join('\n');
}

function trackSummaryLine(name, entry) {
  const aliases = Array.isArray(entry.aliases) && entry.aliases.length
    ? ` aliases: ${entry.aliases.join(', ')}`
    : '';
  const status = entry.status || 'active';
  const description = entry.description ? ` - ${entry.description}` : '';
  return `- ${name} (${status})${aliases}${description}`;
}

function trackListBlock(config) {
  const entries = Object.entries(config.workspace_sets || {});
  if (!entries.length) return '- (none configured yet)';
  return entries
    .map(([name, entry]) => trackSummaryLine(name, entry || {}))
    .join('\n');
}

function activeTrackListBlock(config) {
  const entries = Object.entries(config.workspace_sets || {})
    .filter(([_name, entry]) => !['parked', 'archived'].includes(String((entry || {}).status || 'active')));
  if (!entries.length) return '- (none active; inspect all tracks before editing)';
  return entries
    .map(([name, entry]) => trackSummaryLine(name, entry || {}))
    .join('\n');
}

function renderOnboardingFiles(config) {
  const vars = {
    WORKSPACE_NAME: config.name || path.basename(config.root),
    WORKSPACE_ROOT: config.root,
    CONFIG_PATH: path.relative(config.root, config.config_path).replace(/\\/g, '/'),
    DEVTEAM_CLI: devteamCliPath(),
    DEFAULT_TRACK: config.defaults.workspace_set || '(none)',
    ACTIVE_TRACKS: activeTrackListBlock(config),
    ALL_TRACKS: trackListBlock(config),
    OLD_WORKSPACE_BLOCK: oldWorkspaceBlock(config),
  };
  return [
    {
      name: 'AGENTS.md',
      path: path.join(config.root, 'AGENTS.md'),
      content: renderTemplate('AGENTS.md.tmpl', vars),
    },
    {
      name: 'CLAUDE.md',
      path: path.join(config.root, 'CLAUDE.md'),
      content: renderTemplate('CLAUDE.md.tmpl', vars),
    },
    {
      name: 'README.devteam.md',
      path: path.join(config.root, 'README.devteam.md'),
      content: renderTemplate('README.devteam.md.tmpl', vars),
    },
  ];
}

function fileStatus(file, options = {}) {
  const exists = fs.existsSync(file.path);
  const current = exists ? fs.readFileSync(file.path, 'utf8') : null;
  const currentState = !exists ? 'missing' : (current === file.content ? 'current' : 'drift');
  let action = 'plan_create';
  if (currentState === 'current') action = 'noop';
  else if (currentState === 'drift') action = options.force === true ? 'plan_overwrite' : 'skip_existing';

  return {
    name: file.name,
    path: file.path,
    exists,
    state: currentState,
    action,
  };
}

function workspaceOnboard(options = {}) {
  const config = loadWorkspaceConfig(options.root || null);
  if (options.check === true) {
    return agentOnboardingDoctor({
      root: config.root,
      target: options.target || null,
    });
  }

  const files = renderOnboardingFiles(config);
  const results = files.map(file => fileStatus(file, options));
  const write = options.write === true;
  const force = options.force === true;
  const includeContent = options.print === true;
  const written = [];

  if (write) {
    for (const file of files) {
      const status = fileStatus(file, options);
      if (status.state === 'current') {
        written.push({ ...status, result: 'noop' });
        continue;
      }
      if (status.state === 'drift' && !force) {
        written.push({
          ...status,
          result: 'skipped',
          reason: 'file exists and differs; pass --force to overwrite',
        });
        continue;
      }
      fs.writeFileSync(file.path, file.content, 'utf8');
      written.push({
        ...fileStatus(file, options),
        result: status.exists ? 'overwritten' : 'created',
      });
    }
  }

  const entries = write ? written : results;
  return {
    action: 'workspace_onboard',
    workspace: config.root,
    name: config.name || path.basename(config.root),
    config_path: config.config_path,
    write,
    force,
    status: write
      ? (entries.some(item => item.result === 'skipped') ? 'needs_attention' : 'applied')
      : 'planned',
    files: entries.map((entry) => {
      const file = files.find(item => item.name === entry.name);
      return includeContent && file ? { ...entry, content: file.content } : entry;
    }),
    next_action: write
      ? 'Run workspace context --for codex --text from the workspace root, then choose a track for the session.'
      : 'Review the plan, then rerun workspace onboard --write to create missing onboarding files.',
  };
}

function normalizeAgent(value) {
  const text = String(value || 'agent').toLowerCase();
  if (['codex', 'claude', 'human'].includes(text)) return text;
  return 'agent';
}

function trackBuckets(config) {
  const active = [];
  const parked = [];
  const archived = [];
  for (const [name, entry] of Object.entries(config.workspace_sets || {})) {
    const status = String((entry || {}).status || 'active');
    const item = {
      name,
      status,
      aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
      description: entry.description || '',
      worktrees: Array.isArray(entry.worktrees) ? entry.worktrees.length : 0,
    };
    if (status === 'archived') archived.push(item);
    else if (status === 'parked') parked.push(item);
    else active.push(item);
  }
  return { active, parked, archived };
}

function safeTrackList(config, selected, allTracks) {
  try {
    return listTracks({
      root: config.root,
      set: selected || null,
      runtime: true,
      filter: allTracks ? 'all' : 'active',
    });
  } catch (err) {
    return {
      action: 'track_list',
      workspace: config.root,
      active_track: selected || null,
      error: err.message,
      tracks: [],
      totals: { tracks: 0, shown: 0, hidden: 0 },
    };
  }
}

function safeTrackStatus(config, selected) {
  if (!selected) return null;
  try {
    return trackStatus({
      root: config.root,
      set: selected,
      runtime: true,
    });
  } catch (err) {
    return { error: err.message };
  }
}

function workspaceContext(options = {}) {
  const config = loadWorkspaceConfig(options.root || null);
  const agent = normalizeAgent(options.for || options.agent || null);
  const resolved = resolveWorkspaceSet(config, options.set || null, {
    required: false,
    default: false,
  });
  const selected = resolved.value || null;
  const tracks = trackBuckets(config);
  const runtimeList = safeTrackList(config, selected, options.allTracks === true);
  const selectedStatus = safeTrackStatus(config, selected);
  const selectedRuntime = selectedStatus && selectedStatus.track ? selectedStatus.track.runtime || {} : {};
  const primary = selectedRuntime.next_actions && selectedRuntime.next_actions[0]
    ? selectedRuntime.next_actions[0]
    : {
      kind: selected ? 'inspect-track' : 'choose-track',
      summary: selected
        ? 'Inspect the selected track before editing.'
        : 'Choose a track before editing code.',
      command: selected
        ? command(['track', 'context', '--root', shellArg(config.root), '--set', shellArg(selected), '--text'])
        : command(['track', 'list', '--root', shellArg(config.root), '--active-only', '--text']),
    };

  return {
    action: 'workspace_context',
    workspace: config.root,
    name: config.name || path.basename(config.root),
    config_path: config.config_path,
    for: agent,
    default_track: config.defaults.workspace_set || null,
    selected_track: selected,
    selected_source: resolved.source,
    old_workspace: configuredOldWorkspace(config),
    tracks,
    runtime_tracks: {
      shown: runtimeList.tracks || [],
      totals: runtimeList.totals || {},
      error: runtimeList.error || null,
    },
    policy: {
      track_selection: 'session-local; prefer --set <track> or DEVTEAM_TRACK for parallel sessions',
      mutation: 'do not sync, publish, build, deploy, or mutate remote state without explicit user intent',
      evidence: 'record evidence for sync/test/build/deploy steps; start a fresh run when evidence is stale',
    },
    primary_next: primary,
    recommended_commands: {
      context: command(['workspace', 'context', '--root', shellArg(config.root), '--for', agent, '--text']),
      track_picker: command(['track', 'list', '--root', shellArg(config.root), '--active-only', '--text']),
      track_context: selected
        ? command(['track', 'context', '--root', shellArg(config.root), '--set', shellArg(selected), '--text'])
        : null,
      status: selected
        ? command(['status', '--root', shellArg(config.root), '--set', shellArg(selected)])
        : command(['track', 'list', '--root', shellArg(config.root), '--active-only', '--text']),
      session_start: selected
        ? command(['session', 'start', '--root', shellArg(config.root), '--set', shellArg(selected), '--text'])
        : null,
    },
  };
}

function renderTrackGroup(label, items) {
  const lines = [`${label}:`];
  if (!items.length) {
    lines.push('  (none)');
    return lines;
  }
  for (const item of items) {
    const aliases = item.aliases && item.aliases.length ? ` aliases=${item.aliases.join(',')}` : '';
    lines.push(`  - ${item.name}  status=${item.status}  worktrees=${item.worktrees}${aliases}`);
  }
  return lines;
}

function renderWorkspaceContextText(data) {
  const lines = [
    'Devteam Workspace Context',
    '',
    'Workspace:',
    `  name: ${data.name}`,
    `  root: ${shortPath(data.workspace)}`,
    `  config: ${shortPath(data.config_path)}`,
    `  mode: ${data.for}`,
  ];
  if (data.old_workspace) {
    lines.push(`  old_workspace: ${shortPath(data.old_workspace.path)} (${data.old_workspace.policy})`);
  }
  lines.push(
    '',
    'How to work here:',
    '  - Do not treat this as a single repository.',
    '  - Choose a track before editing code.',
    '  - Use --set <track> or DEVTEAM_TRACK for session-local track selection.',
    '  - Record evidence after sync/test/build/deploy work.',
    '  - Do not sync, publish, build, deploy, or mutate remote state without explicit user intent.',
    '',
    'Tracks:',
    ...renderTrackGroup('  Active', data.tracks.active),
    ...renderTrackGroup('  Parked', data.tracks.parked),
    ...renderTrackGroup('  Archived', data.tracks.archived),
    '',
    'Current selection:',
    `  default: ${data.default_track || '-'}`,
    `  selected: ${data.selected_track || '-'} (${data.selected_source || 'none'})`,
  );
  if (data.runtime_tracks && data.runtime_tracks.totals && data.runtime_tracks.totals.hidden) {
    lines.push(`  hidden_by_picker: ${data.runtime_tracks.totals.hidden}`);
  }
  if (data.runtime_tracks && data.runtime_tracks.error) {
    lines.push(`  runtime_warning: ${data.runtime_tracks.error}`);
  }
  lines.push(
    '',
    'Primary next:',
    `  ${data.primary_next.summary}`,
    data.primary_next.command ? `  ${data.primary_next.command}` : null,
    '',
    'Recommended commands:',
    `  ${data.recommended_commands.context}`,
    `  ${data.recommended_commands.track_picker}`,
    data.recommended_commands.track_context ? `  ${data.recommended_commands.track_context}` : null,
    data.recommended_commands.session_start ? `  ${data.recommended_commands.session_start}` : null,
  );
  return lines.filter(line => line !== null).join('\n');
}

function requiredTextCheck(text, pattern) {
  return pattern.test(String(text || ''));
}

function agentOnboardingDoctor(options = {}) {
  const config = loadWorkspaceConfig(options.root || null);
  const files = renderOnboardingFiles(config);
  const checks = [];

  function add(name, status, message, extra = {}) {
    checks.push({ name, status, message, ...extra });
  }

  add('config', 'pass', '.devteam/config.yaml is readable', { path: config.config_path });

  const agents = files.find(file => file.name === 'AGENTS.md');
  const claude = files.find(file => file.name === 'CLAUDE.md');
  const agentsText = agents && fs.existsSync(agents.path) ? fs.readFileSync(agents.path, 'utf8') : '';
  const claudeText = claude && fs.existsSync(claude.path) ? fs.readFileSync(claude.path, 'utf8') : '';

  add('AGENTS.md', agentsText ? 'pass' : 'error', agentsText ? 'AGENTS.md exists' : 'AGENTS.md is missing', { path: agents.path });
  add('CLAUDE.md', claudeText ? 'pass' : 'error', claudeText ? 'CLAUDE.md exists' : 'CLAUDE.md is missing', { path: claude.path });

  if (agentsText) {
    add('agents_context_command',
      requiredTextCheck(agentsText, /workspace\s+context/)
        ? 'pass'
        : 'error',
      'AGENTS.md should point agents to workspace context.');
    add('agents_track_selection',
      requiredTextCheck(agentsText, /--set\s+<track>|DEVTEAM_TRACK/)
        ? 'pass'
        : 'error',
      'AGENTS.md should describe session-local track selection.');
    add('agents_not_single_repo',
      requiredTextCheck(agentsText, /single\s+(repo|repository)/i)
        ? 'pass'
        : 'error',
      'AGENTS.md should warn that the workspace is not a single repo.');
  }
  if (claudeText) {
    add('claude_points_to_agents',
      requiredTextCheck(claudeText, /AGENTS\.md/)
        ? 'pass'
        : 'error',
      'CLAUDE.md should point to AGENTS.md.');
  }

  const defaultTrack = config.defaults.workspace_set || null;
  add('default_track',
    defaultTrack && config.workspace_sets[defaultTrack] ? 'pass' : (defaultTrack ? 'error' : 'warning'),
    defaultTrack
      ? `default track ${defaultTrack} ${config.workspace_sets[defaultTrack] ? 'is resolvable' : 'is missing'}`
      : 'no defaults.workspace_set configured');

  const sourceSkills = (() => {
    try {
      return skillList({
        root: config.root,
        target: options.target || null,
      });
    } catch (err) {
      return { error: err.message, entries: [] };
    }
  })();
  if (sourceSkills.error) {
    add('skills', 'warning', `skill status unavailable: ${sourceSkills.error}`);
  } else {
    for (const skillName of ['devteam-console', 'devteam-status']) {
      const entry = (sourceSkills.entries || []).find(item => item.name === skillName);
      add(`skill_source_${skillName}`,
        entry ? 'pass' : 'warning',
        entry ? `${skillName} source is available (${entry.scope})` : `${skillName} source is missing`);
      if (entry && entry.status !== 'current') {
        add(`skill_install_${skillName}`,
          'warning',
          `${skillName} install status is ${entry.status}; run skill install when this workspace should expose that skill.`);
      }
    }
  }

  let context = null;
  try {
    context = workspaceContext({
      root: config.root,
      for: 'codex',
    });
    add('workspace_context', 'pass', 'workspace context can be generated');
  } catch (err) {
    add('workspace_context', 'error', `workspace context failed: ${err.message}`);
  }

  try {
    listTracks({
      root: config.root,
      runtime: false,
      filter: 'active',
    });
    add('track_picker', 'pass', 'track picker can list configured tracks');
  } catch (err) {
    add('track_picker', 'error', `track picker failed: ${err.message}`);
  }

  const errors = checks.filter(check => check.status === 'error');
  const warnings = checks.filter(check => check.status === 'warning');
  return {
    action: 'agent_onboarding_doctor',
    workspace: config.root,
    name: config.name || path.basename(config.root),
    status: errors.length ? 'needs_attention' : 'pass',
    totals: {
      checks: checks.length,
      errors: errors.length,
      warnings: warnings.length,
    },
    checks,
    context_preview: context ? {
      selected_track: context.selected_track,
      default_track: context.default_track,
      primary_next: context.primary_next,
    } : null,
    next_action: errors.length
      ? 'Run workspace onboard --write to create or refresh onboarding files, then rerun doctor agent-onboarding.'
      : 'Agent onboarding is ready. Start with workspace context, choose a track, then open track context/status.',
  };
}

function renderOnboardText(result) {
  if (result.action === 'agent_onboarding_doctor') {
    return renderAgentOnboardingDoctorText(result);
  }
  const lines = [
    `Workspace: ${shortPath(result.workspace)}`,
    `Status: ${result.status}${result.write ? ' (write)' : ' (plan)'}`,
    `Force: ${result.force ? 'yes' : 'no'}`,
    '',
    'Files:',
  ];
  for (const file of result.files || []) {
    lines.push(`  ${file.name}  ${file.result || file.action}  ${shortPath(file.path)}`);
    if (file.reason) lines.push(`    ${file.reason}`);
  }
  lines.push('', `Next: ${result.next_action}`);
  return lines.join('\n');
}

function renderAgentOnboardingDoctorText(result) {
  const lines = [
    `Workspace: ${shortPath(result.workspace)}`,
    `Status: ${result.status}`,
    `Checks: ${result.totals.checks}, errors: ${result.totals.errors}, warnings: ${result.totals.warnings}`,
    '',
    'Checks:',
  ];
  for (const check of result.checks || []) {
    lines.push(`  ${check.status.padEnd(7)} ${check.name} - ${check.message}`);
    if (check.path) lines.push(`    path: ${shortPath(check.path)}`);
  }
  if (result.context_preview) {
    lines.push(
      '',
      'Context preview:',
      `  default: ${result.context_preview.default_track || '-'}`,
      `  selected: ${result.context_preview.selected_track || '-'}`,
      `  next: ${result.context_preview.primary_next ? result.context_preview.primary_next.summary : '-'}`,
    );
  }
  lines.push('', `Next: ${result.next_action}`);
  return lines.join('\n');
}

function handleWorkspaceOnboarding(subcommand, args) {
  const parsed = parseArgs(args || []);
  if (subcommand === 'context') {
    const result = workspaceContext({
      root: parsed.root || null,
      set: parsed.set || null,
      for: parsed.for || parsed.agent || null,
      allTracks: parsed['all-tracks'] === true,
    });
    if (parsed.text === true) process.stdout.write(renderWorkspaceContextText(result) + '\n');
    else output(result);
    return;
  }
  if (subcommand === 'onboard') {
    const result = workspaceOnboard({
      root: parsed.root || null,
      write: parsed.write === true,
      force: parsed.force === true,
      check: parsed.check === true,
      print: parsed.print === true,
      target: parsed.target || null,
    });
    if (parsed.text === true) process.stdout.write(renderOnboardText(result) + '\n');
    else output(result);
    return;
  }
  error(`Unknown workspace subcommand: '${subcommand}'. Use: scaffold, onboard, context`);
}

module.exports = {
  agentOnboardingDoctor,
  handleWorkspaceOnboarding,
  renderAgentOnboardingDoctorText,
  renderOnboardText,
  renderWorkspaceContextText,
  workspaceContext,
  workspaceOnboard,
};
