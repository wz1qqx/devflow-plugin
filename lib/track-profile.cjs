'use strict';

const fs = require('fs');
const path = require('path');

const { output, error, parseArgs } = require('./core.cjs');
const { loadLiteConfig } = require('./lite-config.cjs');
const { getWorkspaceStatus } = require('./workspace-inventory.cjs');
const { sessionList } = require('./lite-session.cjs');
const { listPresenceEntries } = require('./presence.cjs');
const {
  inferTrackProfile,
  resolveTrackName,
  resolveWorkspaceSet,
} = require('./track-resolver.cjs');
const yaml = require('./yaml.cjs');

const DEFAULT_KEY_ORDER = [
  'workspace_set',
  'env',
  'sync',
  'build',
  'deploy',
  'deploy_flow',
  'validation',
  'server_test',
];

function shortPath(value) {
  const text = String(value || '');
  if (!text) return '';
  const home = require('os').homedir();
  return text.startsWith(home) ? `~${text.slice(home.length)}` : text;
}

function compactList(values, max = 3) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!list.length) return '-';
  const shown = list.slice(0, max).join(',');
  return list.length > max ? `${shown},+${list.length - max}` : shown;
}

function shellArg(value) {
  return JSON.stringify(String(value));
}

function commandFor(config, parts) {
  return [
    'node',
    shellArg(path.join(__dirname, 'devteam.cjs')),
    ...parts,
  ].join(' ');
}

function trackNextActions(config, profile, workspace, dirtyWorktrees, latestRun) {
  if (workspace.totals.missing > 0) {
    return [
      {
        kind: 'materialize',
        summary: 'Materialize missing local worktrees before syncing or testing.',
        command: commandFor(config, [
          'ws', 'materialize',
          '--root', shellArg(config.root),
          '--set', shellArg(profile.name),
        ]),
      },
    ];
  }
  if (dirtyWorktrees.length > 0) {
    return [
      {
        kind: 'inspect-dirty',
        summary: 'Review dirty files before syncing, publishing, or building.',
        command: commandFor(config, [
          'ws', 'status',
          '--root', shellArg(config.root),
          '--set', shellArg(profile.name),
          '--text',
        ]),
      },
    ];
  }
  if (latestRun && latestRun.next_action) {
    return [
      {
        kind: 'continue-run',
        summary: 'Continue from the latest run next action.',
        command: latestRun.next_action,
      },
    ];
  }
  return [
    {
      kind: 'start-run',
      summary: 'Start a fresh remote validation run for this track.',
      command: commandFor(config, [
        'remote-loop', 'start',
        '--root', shellArg(config.root),
        '--set', shellArg(profile.name),
      ]),
    },
  ];
}

function enrichTrackRuntime(config, profile) {
  const workspace = getWorkspaceStatus({
    root: config.root,
    set: profile.name,
  });
  const runs = sessionList({
    root: config.root,
    set: profile.name,
    limit: 1,
    unreadable: false,
  });
  const runHistory = trackRunHistory(config, profile, runs);
  const latestRun = runs.runs && runs.runs.length ? runs.runs[0] : null;
  const dirtyWorktrees = (workspace.worktrees || [])
    .filter(item => item.dirty)
    .map(item => ({
      id: item.id,
      repo: item.repo,
      branch: item.branch || item.desired_branch || null,
      head: item.head || null,
      dirty_file_count: item.dirty_file_count || 0,
      dirty_summary: item.dirty_summary || { staged: 0, unstaged: 0, untracked: 0 },
    }));

  const nextActions = trackNextActions(config, profile, workspace, dirtyWorktrees, latestRun);
  const presence = listPresenceEntries(config)
    .filter(entry => entry.active && entry.track === profile.name)
    .slice(0, 5)
    .map(entry => ({
      session_id: entry.session_id,
      status: entry.status || null,
      run_id: entry.run_id || null,
      purpose: entry.purpose || null,
      last_seen_at: entry.last_seen_at || null,
      age_seconds: entry.age_seconds,
      tool: entry.tool || null,
    }));

  return {
    workspace: workspace.totals,
    dirty_worktrees: dirtyWorktrees,
    latest_run: latestRun ? {
      run_id: latestRun.run_id,
      phase: latestRun.phase || null,
      evidence: latestRun.evidence || null,
      image: latestRun.image || null,
      next_action: latestRun.next_action || null,
    } : null,
    presence,
    presence_count: presence.length,
    run_history: runHistory,
    next_actions: nextActions,
    next_action: nextActions[0] ? nextActions[0].command : null,
  };
}

function enrichTrack(config, profile) {
  return {
    ...profile,
    runtime: enrichTrackRuntime(config, profile),
  };
}

function hasOpenRun(track) {
  const latest = track.runtime && track.runtime.latest_run ? track.runtime.latest_run : null;
  if (!latest || !latest.phase) return false;
  const status = latest.phase.status || '';
  const name = latest.phase.name || '';
  return !['complete', 'ready'].includes(status) && !['complete'].includes(name);
}

function trackVisibleByDefault(track, config) {
  const status = track.status || 'active';
  const runtime = track.runtime || {};
  const workspace = runtime.workspace || {};
  if (track.active) return true;
  if (track.name === config.defaults.workspace_set) return true;
  if (status === 'active') return true;
  if ((workspace.dirty || 0) > 0 || (workspace.missing || 0) > 0) return true;
  if ((runtime.presence_count || 0) > 0) return true;
  if (hasOpenRun(track)) return true;
  return false;
}

function listTracks(options = {}) {
  const config = loadLiteConfig(options.root || null);
  const includeRuntime = options.runtime !== false;
  const active = resolveWorkspaceSet(config, options.set || null, { required: false });
  const allTracks = Object.keys(config.workspace_sets).map(name => {
    const profile = inferTrackProfile(config, name, { activeTrack: active.value || null });
    return includeRuntime ? enrichTrack(config, profile) : profile;
  });
  const filter = options.filter || 'all';
  const tracks = filter === 'active'
    ? allTracks.filter(track => trackVisibleByDefault(track, config))
    : allTracks;
  return {
    action: 'track_list',
    workspace: config.root,
    active_track: active.value || null,
    active_source: active.source,
    default_track: config.defaults.workspace_set || null,
    filter,
    totals: {
      tracks: allTracks.length,
      shown: tracks.length,
      hidden: allTracks.length - tracks.length,
    },
    tracks,
  };
}

function trackStatus(options = {}) {
  const config = loadLiteConfig(options.root || null);
  const active = resolveWorkspaceSet(config, options.set || null, { required: false });
  const activeTrack = active.value || null;
  const profile = activeTrack ? inferTrackProfile(config, activeTrack, { activeTrack }) : null;
  const includeRuntime = options.runtime !== false;
  return {
    action: 'track_status',
    workspace: config.root,
    active_track: activeTrack,
    active_source: active.source,
    default_track: config.defaults.workspace_set || null,
    defaults: config.defaults,
    track: profile && includeRuntime ? enrichTrack(config, profile) : profile,
  };
}

function phaseText(run) {
  if (!run || !run.phase) return 'no-run';
  return `${run.phase.name || '-'}:${run.phase.status || '-'}`;
}

function runLifecycleLabel(run) {
  const lifecycle = run && run.lifecycle ? run.lifecycle : {};
  return lifecycle.status || 'open';
}

function trackRunHistory(config, profile, openRuns) {
  const allRuns = sessionList({
    root: config.root,
    set: profile.name,
    limit: 200,
    unreadable: false,
    includeClosed: true,
  });
  const totals = {
    all: allRuns.totals ? allRuns.totals.matched || 0 : 0,
    open: 0,
    closed: 0,
    superseded: 0,
    archived: 0,
    other: 0,
    unreadable: allRuns.totals ? allRuns.totals.unreadable || 0 : 0,
  };
  for (const run of allRuns.runs || []) {
    const label = runLifecycleLabel(run);
    if (label === 'open') totals.open += 1;
    else if (label === 'closed') totals.closed += 1;
    else if (label === 'superseded') totals.superseded += 1;
    else if (label === 'archived') totals.archived += 1;
    else totals.other += 1;
  }
  return {
    totals,
    latest_open_run_id: openRuns && openRuns.runs && openRuns.runs[0] ? openRuns.runs[0].run_id : null,
    latest_any_run_id: allRuns.runs && allRuns.runs[0] ? allRuns.runs[0].run_id : null,
  };
}

function runHistoryText(history) {
  const totals = history && history.totals ? history.totals : {};
  const parts = [`open:${totals.open || 0}`];
  if (totals.closed) parts.push(`closed:${totals.closed}`);
  if (totals.superseded) parts.push(`superseded:${totals.superseded}`);
  if (totals.archived) parts.push(`archived:${totals.archived}`);
  if (totals.other) parts.push(`other:${totals.other}`);
  if (totals.unreadable) parts.push(`unreadable:${totals.unreadable}`);
  return parts.join(' ');
}

function renderTrackListText(list) {
  const lines = [
    `Workspace: ${shortPath(list.workspace)}`,
    `Selected track: ${list.active_track || '(none)'} (${list.active_source || 'none'})`,
    `Workspace default: ${list.default_track || '(none)'}`,
    `Filter: ${list.filter || 'all'}${list.totals && list.totals.hidden ? ` (${list.totals.hidden} hidden)` : ''}`,
    '',
    'Tracks:',
  ];
  if (!list.tracks.length) {
    lines.push('  (none)');
    return lines.join('\n');
  }
  for (const track of list.tracks) {
    const active = track.active ? '*' : ' ';
    const runtime = track.runtime || {};
    const totals = runtime.workspace || {};
    const latest = runtime.latest_run || null;
    const dirty = runtime.dirty_worktrees || [];
    const runHistory = runHistoryText(runtime.run_history);
    const status = track.status || 'active';
    lines.push(
      `${active} ${track.name}  status:${status}  worktrees:${totals.present || 0}/${totals.worktrees || track.worktrees || 0}` +
      ` dirty:${totals.dirty || 0}  run:${latest ? latest.run_id : '-'}  phase:${phaseText(latest)}  runs:${runHistory}`
    );
    lines.push(
      `    env:${track.env || '-'} sync:${track.sync || '-'} build:${track.build || '-'} ` +
      `deploy:${track.deploy || '-'} validation:${track.validation || '-'}`
    );
    if (dirty.length) {
      const dirtyText = dirty
        .slice(0, 3)
        .map(item => `${item.id}:${item.dirty_file_count}`)
        .join(', ');
      lines.push(`    dirty: ${dirtyText}${dirty.length > 3 ? `,+${dirty.length - 3}` : ''}`);
    }
    if (runtime.presence_count) {
      const presenceText = (runtime.presence || [])
        .slice(0, 3)
        .map(item => `${item.session_id}${item.purpose ? `:${item.purpose}` : ''}`)
        .join(', ');
      lines.push(`    presence: ${runtime.presence_count} active${presenceText ? ` (${presenceText})` : ''}`);
    }
    if (runtime.next_actions && runtime.next_actions[0]) {
      lines.push(`    next: ${runtime.next_actions[0].command}`);
    }
  }
  return lines.join('\n');
}

function renderTrackStatusText(status) {
  const track = status.track || null;
  const lines = [
    `Workspace: ${shortPath(status.workspace)}`,
    `Selected track: ${status.active_track || '(none)'} (${status.active_source || 'none'})`,
    `Workspace default: ${status.default_track || '(none)'}`,
  ];
  if (!track) {
    lines.push('Track: (none)');
    return lines.join('\n');
  }
  const runtime = track.runtime || {};
  const totals = runtime.workspace || {};
  const latest = runtime.latest_run || null;
  const runHistory = runHistoryText(runtime.run_history);
  lines.push(
    `Track: ${track.name}  ${track.description || ''}`.trim(),
    `Profiles: env=${track.env || '-'} sync=${track.sync || '-'} build=${track.build || '-'} deploy=${track.deploy || '-'} validation=${track.validation || '-'}`,
    `Worktrees: ${totals.present || 0}/${totals.worktrees || track.worktrees || 0} present, ${totals.dirty || 0} dirty, ${totals.missing || 0} missing`,
    `Repos: ${compactList(track.repos)}`,
    `Latest run: ${latest ? latest.run_id : '-'}  phase=${phaseText(latest)}`,
    `Run history: ${runHistory}`,
  );
  if (latest && latest.evidence) {
    lines.push(`Evidence: passed=${compactList(latest.evidence.passed)} missing=${compactList(latest.evidence.missing)}`);
  }
  if (latest && latest.image && latest.image.image) {
    lines.push(`Image: ${latest.image.image}`);
  }
  const dirty = runtime.dirty_worktrees || [];
  if (dirty.length) {
    lines.push('Dirty worktrees:');
    for (const item of dirty.slice(0, 5)) {
      lines.push(`  ${item.id} ${item.branch || '-'} @ ${item.head || '-'} files=${item.dirty_file_count}`);
    }
  }
  if (runtime.presence_count) {
    lines.push('Active sessions:');
    for (const item of (runtime.presence || []).slice(0, 5)) {
      const age = item.age_seconds == null ? '-' : `${item.age_seconds}s`;
      lines.push(`  ${item.session_id} age=${age}${item.run_id ? ` run=${item.run_id}` : ''}${item.purpose ? ` purpose=${item.purpose}` : ''}`);
    }
  }
  const nextActions = runtime.next_actions || [];
  if (nextActions.length) {
    lines.push('Next:');
    for (const action of nextActions.slice(0, 3)) {
      lines.push(`  ${action.summary}`);
      if (action.command) lines.push(`  ${action.command}`);
    }
  } else {
    lines.push('Next: No immediate action.');
  }
  return lines.join('\n');
}

function yamlScalar(value) {
  if (value == null || value === '') return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return JSON.stringify(String(value));
}

function renderDefaultsBlock(defaults) {
  const keys = [
    ...DEFAULT_KEY_ORDER.filter(key => Object.prototype.hasOwnProperty.call(defaults, key)),
    ...Object.keys(defaults).filter(key => !DEFAULT_KEY_ORDER.includes(key)).sort(),
  ];
  return [
    'defaults:',
    ...keys.map(key => `  ${key}: ${yamlScalar(defaults[key])}`),
  ].join('\n');
}

function replaceDefaultsBlock(text, defaults) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => /^defaults:\s*(#.*)?$/.test(line));
  const block = renderDefaultsBlock(defaults).split('\n');
  if (start === -1) {
    const suffix = text.endsWith('\n') ? '' : '\n';
    return `${text}${suffix}\n${block.join('\n')}\n`;
  }

  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (/^\S/.test(line) && line.trim() !== '') break;
    end++;
  }
  const next = [
    ...lines.slice(0, start),
    ...block,
    ...(end < lines.length ? [''] : []),
    ...lines.slice(end),
  ].join('\n');
  return next.endsWith('\n') ? next : `${next}\n`;
}

function readRawConfig(configPath) {
  try {
    return yaml.parse(fs.readFileSync(configPath, 'utf8')) || {};
  } catch (err) {
    error(`Failed to parse ${configPath}: ${err.message}`);
  }
}

function useTrack(options = {}) {
  const config = loadLiteConfig(options.root || null);
  const trackInput = options.track || null;
  if (!trackInput) error('track use requires <track>.');
  const track = resolveTrackName(config, trackInput);
  const profile = inferTrackProfile(config, track);
  const raw = readRawConfig(config.config_path);
  const currentDefaults = raw.defaults && typeof raw.defaults === 'object' && !Array.isArray(raw.defaults)
    ? raw.defaults
    : {};
  const nextDefaults = {
    ...currentDefaults,
    workspace_set: track,
    env: profile.env,
    sync: profile.sync,
    build: profile.build,
    deploy: profile.deploy,
    deploy_flow: profile.deploy_flow,
    validation: profile.validation,
  };

  const before = fs.readFileSync(config.config_path, 'utf8');
  const after = replaceDefaultsBlock(before, nextDefaults);
  const changed = before !== after;
  if (options.dryRun !== true && changed) {
    fs.writeFileSync(config.config_path, after, 'utf8');
  }

  return {
    action: 'track_use',
    workspace: config.root,
    config_path: config.config_path,
    track,
    dry_run: options.dryRun === true,
    changed,
    previous_defaults: config.defaults,
    next_defaults: {
      workspace_set: track,
      env: profile.env,
      sync: profile.sync,
      build: profile.build,
      deploy: profile.deploy,
      deploy_flow: profile.deploy_flow,
      validation: profile.validation,
      server_test: currentDefaults.server_test ? String(currentDefaults.server_test) : null,
    },
    track_profile: {
      ...profile,
      active: true,
    },
  };
}

function bindTrack(options = {}) {
  const config = loadLiteConfig(options.root || null);
  const trackInput = options.track || null;
  if (!trackInput) error('track bind requires <track>.');
  const track = resolveTrackName(config, trackInput);
  const profile = inferTrackProfile(config, track, { activeTrack: track });
  return {
    action: 'track_bind',
    workspace: config.root,
    track,
    profile,
    exports: {
      DEVTEAM_TRACK: track,
    },
    command: `export DEVTEAM_TRACK=${shellArg(track)}`,
    dt_function: `dt() { node ${shellArg(path.join(__dirname, 'devteam.cjs'))} "$@" --root ${shellArg(config.root)}; }`,
    next_action: 'Run the export command in this terminal/session, or pass --set explicitly. This does not modify .devteam/config.yaml.',
  };
}

function handleTrack(subcommand, args) {
  const parsed = parseArgs(args || []);
  if (!subcommand || subcommand === 'list') {
    const result = listTracks({
      root: parsed.root || null,
      set: parsed.set || null,
      runtime: parsed['no-runtime'] === true ? false : true,
      filter: parsed['active-only'] === true ? 'active' : 'all',
    });
    if (parsed.text === true) {
      process.stdout.write(renderTrackListText(result) + '\n');
    } else {
      output(result);
    }
    return;
  }
  if (subcommand === 'status') {
    const result = trackStatus({
      root: parsed.root || null,
      set: parsed.set || null,
      runtime: parsed['no-runtime'] === true ? false : true,
    });
    if (parsed.text === true) {
      process.stdout.write(renderTrackStatusText(result) + '\n');
    } else {
      output(result);
    }
    return;
  }
  if (subcommand === 'use') {
    output(useTrack({
      root: parsed.root || null,
      track: parsed._[0] || parsed.track || null,
      dryRun: parsed['dry-run'] === true,
    }));
    return;
  }
  if (subcommand === 'bind') {
    const result = bindTrack({
      root: parsed.root || null,
      track: parsed._[0] || parsed.track || parsed.set || null,
    });
    if (parsed.text === true) {
      process.stdout.write([
        `Workspace: ${shortPath(result.workspace)}`,
        `Track: ${result.track}`,
        `Command: ${result.command}`,
        `dt: ${result.dt_function}`,
        `Next: ${result.next_action}`,
      ].join('\n') + '\n');
    } else {
      output(result);
    }
    return;
  }
  error(`Unknown track subcommand: '${subcommand}'. Use: list, status, use, bind`);
}

module.exports = {
  handleTrack,
  bindTrack,
  inferTrackProfile,
  listTracks,
  renderTrackListText,
  renderTrackStatusText,
  trackStatus,
  useTrack,
};
