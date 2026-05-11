'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { output, error, parseArgs, expandHome } = require('./core.cjs');
const { loadLiteConfig, resolvePath } = require('./lite-config.cjs');
const yaml = require('./yaml.cjs');

const DEFAULT_TARGET_DIR = path.join(os.homedir(), '.agents', 'skills');

function shortPath(value) {
  const text = String(value || '');
  if (!text) return '';
  const home = os.homedir();
  return text.startsWith(home) ? `~${text.slice(home.length)}` : text;
}

function shellArg(value) {
  return JSON.stringify(String(value));
}

function commandFor(parts) {
  return [
    'node',
    shellArg(path.join(__dirname, 'devteam.cjs')),
    ...parts,
  ].join(' ');
}

function resolveTargetDir(value) {
  const raw = value || process.env.DEVTEAM_SKILL_TARGET || DEFAULT_TARGET_DIR;
  return path.resolve(expandHome(String(raw)));
}

function configuredWorkspaceSkillDir(config) {
  const knowledge = config.knowledge || {};
  return resolvePath(config.root, knowledge.skills_dir || '.devteam/skills');
}

function repoSkillDir() {
  return path.resolve(__dirname, '..', 'skills');
}

function hasSkillMd(dir) {
  return fs.existsSync(path.join(dir, 'SKILL.md'));
}

function skillDirsUnder(dir, scope) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(dir, entry.name))
    .filter(hasSkillMd)
    .sort((a, b) => a.localeCompare(b))
    .map(dirPath => ({
      scope,
      dir: dirPath,
      folder: path.basename(dirPath),
    }));
}

function extractFrontmatter(skillPath) {
  const text = fs.readFileSync(skillPath, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return {
      data: {},
      content: text,
      problems: ['missing_frontmatter'],
    };
  }
  try {
    return {
      data: yaml.parse(match[1]) || {},
      content: text.slice(match[0].length),
      problems: [],
    };
  } catch (err) {
    return {
      data: {},
      content: text.slice(match[0].length),
      problems: [`invalid_frontmatter: ${err.message}`],
    };
  }
}

function skillHash(dir) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const files = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.DS_Store' || entry.name === '__pycache__') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
  files.sort((a, b) => a.localeCompare(b));
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const rel = path.relative(dir, file).replace(/\\/g, '/');
    hash.update(`file:${rel}\n`);
    hash.update(fs.readFileSync(file));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function readSkillSource(raw) {
  const skillPath = path.join(raw.dir, 'SKILL.md');
  const frontmatter = extractFrontmatter(skillPath);
  const name = frontmatter.data.name ? String(frontmatter.data.name) : raw.folder;
  const description = frontmatter.data.description ? String(frontmatter.data.description) : '';
  const problems = [...frontmatter.problems];
  if (!frontmatter.data.name) problems.push('frontmatter.name_missing');
  if (!frontmatter.data.description) problems.push('frontmatter.description_missing');
  if (frontmatter.data.name && String(frontmatter.data.name) !== raw.folder) {
    problems.push(`folder_name_mismatch:${raw.folder}->${frontmatter.data.name}`);
  }
  return {
    name,
    description,
    scope: raw.scope,
    folder: raw.folder,
    source_path: raw.dir,
    skill_path: skillPath,
    source_hash: skillHash(raw.dir),
    valid: problems.length === 0,
    problems,
  };
}

function collectSkillSources(config) {
  const raw = [
    ...skillDirsUnder(repoSkillDir(), 'repo'),
    ...skillDirsUnder(configuredWorkspaceSkillDir(config), 'workspace'),
  ].map(readSkillSource);

  const byName = new Map();
  const conflicts = [];
  const priority = { workspace: 2, repo: 1 };
  for (const source of raw) {
    const existing = byName.get(source.name);
    if (!existing) {
      byName.set(source.name, source);
      continue;
    }
    conflicts.push({
      type: 'duplicate_skill_source',
      name: source.name,
      sources: [existing.source_path, source.source_path],
    });
    if ((priority[source.scope] || 0) > (priority[existing.scope] || 0)) {
      byName.set(source.name, source);
    }
  }

  return {
    sources: Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name)),
    raw_sources: raw,
    conflicts,
  };
}

function installedStatus(source, targetDir) {
  const installPath = path.join(targetDir, source.name);
  const installed = fs.existsSync(installPath) && fs.statSync(installPath).isDirectory();
  const installedHash = installed ? skillHash(installPath) : null;
  const status = !source.valid
    ? 'invalid_source'
    : (!installed
      ? 'missing'
      : (installedHash === source.source_hash ? 'current' : 'drift'));
  return {
    installed,
    install_path: installPath,
    installed_hash: installedHash,
    status,
  };
}

function skillList(options = {}) {
  const config = loadLiteConfig(options.root || null);
  const targetDir = resolveTargetDir(options.target || null);
  const collected = collectSkillSources(config);
  const entries = collected.sources.map(source => ({
    ...source,
    ...installedStatus(source, targetDir),
  }));
  return {
    action: 'skill_list',
    workspace: config.root,
    target_dir: targetDir,
    source_dirs: {
      repo: repoSkillDir(),
      workspace: configuredWorkspaceSkillDir(config),
    },
    totals: {
      skills: entries.length,
      current: entries.filter(entry => entry.status === 'current').length,
      missing: entries.filter(entry => entry.status === 'missing').length,
      drift: entries.filter(entry => entry.status === 'drift').length,
      invalid: entries.filter(entry => entry.status === 'invalid_source').length,
      conflicts: collected.conflicts.length,
    },
    entries,
    conflicts: collected.conflicts,
  };
}

function skillLint(options = {}) {
  const config = loadLiteConfig(options.root || null);
  const collected = collectSkillSources(config);
  const problems = [];
  for (const source of collected.raw_sources) {
    for (const problem of source.problems || []) {
      problems.push({
        type: 'invalid_skill_source',
        skill: source.name,
        scope: source.scope,
        path: source.source_path,
        problem,
      });
    }
  }
  for (const conflict of collected.conflicts) {
    problems.push(conflict);
  }
  return {
    action: 'skill_lint',
    workspace: config.root,
    status: problems.length ? 'needs_attention' : 'pass',
    totals: {
      sources: collected.raw_sources.length,
      installable: collected.sources.length,
      problems: problems.length,
    },
    problems,
  };
}

function selectInstallSources(list, options) {
  const names = options.all === true
    ? list.entries.map(entry => entry.name)
    : (options.names || []);
  if (!names.length) {
    error('skill install requires a skill name or --all.');
  }
  const byName = new Map(list.entries.map(entry => [entry.name, entry]));
  return names.map(name => {
    const source = byName.get(name);
    if (!source) {
      return {
        name,
        action: 'blocked',
        status: 'skipped',
        blocked_by: ['unknown_skill'],
      };
    }
    const blockedBy = [];
    if (!source.valid) blockedBy.push('invalid_source');
    const action = blockedBy.length
      ? 'blocked'
      : (source.status === 'current' ? 'noop' : 'install');
    return {
      ...source,
      action,
      status: action === 'install' ? 'planned' : 'skipped',
      blocked_by: blockedBy,
      command: action !== 'install'
        ? null
        : commandFor([
          'skill', 'install',
          shellArg(source.name),
          '--root', shellArg(list.workspace),
          '--target', shellArg(list.target_dir),
          '--yes',
        ]),
    };
  });
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

function installOne(plan) {
  if (plan.action !== 'install') {
    return {
      ...plan,
      status: plan.action === 'noop' ? 'skipped' : 'skipped',
    };
  }
  if (fs.existsSync(plan.install_path) && !fs.statSync(plan.install_path).isDirectory()) {
    return {
      ...plan,
      status: 'failed',
      error: `install target exists and is not a directory: ${plan.install_path}`,
    };
  }
  fs.rmSync(plan.install_path, { recursive: true, force: true });
  copyDir(plan.source_path, plan.install_path);
  const installedHash = skillHash(plan.install_path);
  return {
    ...plan,
    installed: true,
    installed_hash: installedHash,
    status: installedHash === plan.source_hash ? 'installed' : 'failed',
  };
}

function skillInstall(options = {}) {
  const list = skillList(options);
  const plans = selectInstallSources(list, options);
  const execute = options.yes === true;
  const results = execute
    ? plans.map(installOne)
    : plans;
  const failed = results.filter(item => item.status === 'failed').length;
  const blocked = results.filter(item => item.action === 'blocked').length;
  const installed = results.filter(item => item.status === 'installed').length;
  const planned = results.filter(item => item.status === 'planned' && item.action === 'install').length;
  const noop = results.filter(item => item.action === 'noop').length;
  return {
    action: 'skill_install',
    workspace: list.workspace,
    target_dir: list.target_dir,
    dry_run: !execute,
    status: failed
      ? 'failed'
      : (blocked ? 'blocked' : (planned === 0 && installed === 0 && noop > 0 ? 'noop' : (execute ? 'applied' : 'planned'))),
    totals: {
      entries: results.length,
      planned,
      installed,
      noop,
      blocked,
      failed,
    },
    results,
    next_action: planned === 0 && installed === 0 && noop > 0
      ? 'Installed skill copies already match the selected source skills.'
      : (execute
        ? 'Restart or refresh the agent session if newly installed skills are not visible yet.'
        : 'Review the install plan, then rerun with --yes to copy skill folders into the target skill directory.'),
  };
}

function renderSkillListText(data) {
  const lines = [
    `Workspace: ${shortPath(data.workspace)}`,
    `Target: ${shortPath(data.target_dir)}`,
    `Skills: ${data.totals.skills} total, ${data.totals.current} current, ${data.totals.missing} missing, ${data.totals.drift} drift, ${data.totals.invalid} invalid`,
    '',
    'Skills:',
  ];
  if (!data.entries.length) {
    lines.push('  (none)');
  }
  for (const entry of data.entries) {
    lines.push(`  ${entry.name}  ${entry.scope}  ${entry.status}  ${shortPath(entry.source_path)}`);
    if (entry.status === 'missing' || entry.status === 'drift') {
      lines.push(`    install: ${commandFor([
        'skill', 'install',
        shellArg(entry.name),
        '--root', shellArg(data.workspace),
        '--target', shellArg(data.target_dir),
        '--yes',
      ])}`);
    }
    if (entry.problems && entry.problems.length) {
      lines.push(`    problems: ${entry.problems.join(', ')}`);
    }
  }
  if (data.conflicts && data.conflicts.length) {
    lines.push('', 'Conflicts:');
    for (const conflict of data.conflicts) {
      lines.push(`  ${conflict.name}: ${(conflict.sources || []).map(shortPath).join(', ')}`);
    }
  }
  return lines.join('\n');
}

function renderSkillLintText(data) {
  const lines = [
    `Workspace: ${shortPath(data.workspace)}`,
    `Status: ${data.status}`,
    `Sources: ${data.totals.sources}, installable: ${data.totals.installable}, problems: ${data.totals.problems}`,
  ];
  if (data.problems.length) {
    lines.push('', 'Problems:');
    for (const problem of data.problems) {
      lines.push(`  ${problem.type} ${problem.skill || problem.name || '-'} ${problem.problem || ''}`.trim());
      if (problem.path) lines.push(`    path: ${shortPath(problem.path)}`);
    }
  }
  return lines.join('\n');
}

function renderSkillInstallText(data) {
  const lines = [
    `Workspace: ${shortPath(data.workspace)}`,
    `Target: ${shortPath(data.target_dir)}`,
    `Status: ${data.status}${data.dry_run ? ' (dry-run)' : ''}`,
    `Entries: ${data.totals.entries}, planned: ${data.totals.planned}, installed: ${data.totals.installed}, noop: ${data.totals.noop}, blocked: ${data.totals.blocked}, failed: ${data.totals.failed}`,
  ];
  if (data.results.length) {
    lines.push('', 'Results:');
    for (const result of data.results) {
      lines.push(`  ${result.name}  ${result.action}  ${result.status}`);
      if (result.blocked_by && result.blocked_by.length) {
        lines.push(`    blocked_by: ${result.blocked_by.join(', ')}`);
      }
      if (result.command) lines.push(`    command: ${result.command}`);
      if (result.error) lines.push(`    error: ${result.error}`);
    }
  }
  lines.push('', `Next: ${data.next_action}`);
  return lines.join('\n');
}

function handleLiteSkill(subcommand, args) {
  const parsed = parseArgs(args || []);
  const positional = parsed._ || [];
  const common = {
    root: parsed.root || null,
    target: parsed.target || null,
  };
  if (!subcommand || subcommand === 'status' || subcommand === 'list') {
    const data = skillList(common);
    if (parsed.text === true) process.stdout.write(renderSkillListText(data) + '\n');
    else output(data);
    return;
  }
  if (subcommand === 'lint') {
    const data = skillLint(common);
    if (parsed.text === true) process.stdout.write(renderSkillLintText(data) + '\n');
    else output(data);
    return;
  }
  if (subcommand === 'install') {
    const data = skillInstall({
      ...common,
      names: positional.length ? positional : (parsed.name ? [parsed.name] : []),
      all: parsed.all === true,
      yes: parsed.yes === true,
    });
    if (parsed.text === true) process.stdout.write(renderSkillInstallText(data) + '\n');
    else output(data);
    return;
  }
  error(`Unknown skill subcommand: '${subcommand}'. Use: list, status, lint, install`);
}

module.exports = {
  collectSkillSources,
  handleLiteSkill,
  skillInstall,
  skillLint,
  skillList,
};
