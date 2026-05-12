'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { output, error, parseArgs } = require('./core.cjs');
const { loadWorkspaceConfig } = require('./workspace-config.cjs');
const {
  inferTrackProfile,
  resolveWorkspaceSet,
} = require('./track-resolver.cjs');

function resolveRunDir(config, runValue) {
  if (!runValue) return null;
  const value = String(runValue);
  const absolute = path.isAbsolute(value)
    ? value
    : path.join(config.root, '.devteam', 'runs', value);
  if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return path.dirname(absolute);
  return absolute;
}

function readRunEvents(config, runValue) {
  const runDir = resolveRunDir(config, runValue);
  if (!runDir) return null;
  const eventsPath = path.join(runDir, 'events.jsonl');
  const events = fs.existsSync(eventsPath)
    ? fs.readFileSync(eventsPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line))
    : [];
  const latest = {};
  for (const event of events) {
    latest[event.kind] = event;
  }
  return {
    run_id: path.basename(runDir),
    run_dir: runDir,
    events_path: eventsPath,
    events,
    latest,
  };
}

function worktreeHeadMap(items) {
  const map = {};
  for (const item of items || []) {
    if (!item || !item.id) continue;
    map[item.id] = {
      id: item.id,
      repo: item.repo || null,
      path: item.path || null,
      branch: item.branch || item.desired_branch || null,
      head: item.head || null,
      exists: item.exists !== false,
    };
  }
  return map;
}

function sessionWorktreeHeads(session) {
  return worktreeHeadMap(
    session && session.workspace_status && Array.isArray(session.workspace_status.worktrees)
      ? session.workspace_status.worktrees
      : []
  );
}

function eventWorktreeHeads(event) {
  if (!event || !Array.isArray(event.worktree_heads)) return {};
  return worktreeHeadMap(event.worktree_heads);
}

function compareWorktreeHeads(expectedMap, currentItems) {
  const changes = [];
  const unknown = [];
  const currentMap = worktreeHeadMap(currentItems);
  for (const [id, current] of Object.entries(currentMap)) {
    const expected = expectedMap[id] || null;
    if (!expected || !expected.head || !current.head) {
      unknown.push({
        id,
        expected_head: expected ? expected.head || null : null,
        current_head: current.head || null,
      });
      continue;
    }
    if (expected.head !== current.head) {
      changes.push({
        id,
        repo: current.repo || expected.repo || null,
        path: current.path || expected.path || null,
        expected_head: expected.head,
        current_head: current.head,
      });
    }
  }
  return {
    status: changes.length > 0 ? 'changed' : (unknown.length > 0 ? 'unknown' : 'current'),
    changes,
    unknown,
  };
}

function normalizeList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean);
  return [];
}

function git(worktreePath, args) {
  try {
    return execFileSync('git', ['-C', worktreePath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (_) {
    return null;
  }
}

function splitLines(value) {
  if (!value) return [];
  return String(value).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function uniqueList(items) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

function selectedWorktreeIds(config, setName) {
  const resolved = resolveWorkspaceSet(config, setName || null, { required: false }).value || null;
  if (!resolved) return Object.keys(config.worktrees);
  const set = config.workspace_sets[resolved];
  if (!set) return [];
  return Array.isArray(set.worktrees) ? set.worktrees : [];
}

function inspectWorktreeHead(config, id) {
  const entry = config.worktrees[id] || null;
  if (!entry) {
    return {
      id,
      exists: false,
      status: 'undefined',
      repo: null,
      path: null,
      branch: null,
      head: null,
      base_ref: null,
    };
  }
  const exists = Boolean(entry.abs_path && fs.existsSync(entry.abs_path));
  return {
    id,
    exists,
    repo: entry.repo || null,
    path: entry.path || null,
    abs_path: entry.abs_path || null,
    branch: exists ? git(entry.abs_path, ['rev-parse', '--abbrev-ref', 'HEAD']) : null,
    head: exists ? git(entry.abs_path, ['rev-parse', '--short', 'HEAD']) : null,
    base_ref: entry.base_ref || null,
    roles: entry.roles || [],
  };
}

function currentWorktreeHeads(config, setName) {
  return selectedWorktreeIds(config, setName).map(id => inspectWorktreeHead(config, id));
}

function readRunSession(run) {
  if (!run || !run.run_dir) return null;
  const sessionPath = path.join(run.run_dir, 'session.json');
  if (!fs.existsSync(sessionPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function pathMatchesPattern(filePath, pattern) {
  const file = String(filePath || '');
  const raw = String(pattern || '').trim();
  if (!raw) return false;
  if (raw.endsWith('/')) return file === raw.slice(0, -1) || file.startsWith(raw);
  if (raw.includes('*')) {
    const escaped = raw
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*');
    return new RegExp(`^${escaped}$`).test(file);
  }
  return file === raw || file.startsWith(`${raw}/`);
}

function pathMatchesAny(filePath, patterns) {
  const list = normalizeList(patterns);
  if (!list.length) return true;
  return list.some(pattern => pathMatchesPattern(filePath, pattern));
}

function changedFiles(worktree, diffBase) {
  if (!worktree || !worktree.abs_path || !fs.existsSync(worktree.abs_path)) {
    return { files: [], error: 'worktree_missing' };
  }
  const files = [];
  if (diffBase) {
    const branchDiff = git(worktree.abs_path, ['diff', '--name-only', '--diff-filter=ACMRTUXB', `${diffBase}..HEAD`]);
    if (branchDiff == null) return { files: [], error: `diff_base_unavailable:${diffBase}` };
    files.push(...splitLines(branchDiff));
  }
  files.push(...splitLines(git(worktree.abs_path, ['diff', '--name-only', '--diff-filter=ACMRTUXB']) || ''));
  files.push(...splitLines(git(worktree.abs_path, ['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB']) || ''));
  files.push(...splitLines(git(worktree.abs_path, ['ls-files', '--others', '--exclude-standard']) || ''));
  return { files: uniqueList(files), error: null };
}

const DEFAULT_VLLM_UNSAFE_PATCH_PATHS = [
  'csrc/',
  'cmake/',
  'CMakeLists.txt',
  'setup.py',
  'pyproject.toml',
  'requirements/',
  'docker/',
  '.dockerignore',
];

const DEFAULT_PEGAFLOW_UNSAFE_OVERLAY_PATHS = [
  'Cargo.toml',
  'Cargo.lock',
  'src/',
  'crates/',
  'pegaflow/',
  'python/pyproject.toml',
  'scripts/build-wheel.sh',
];

function patchAssessment(config, worktreeId, options = {}) {
  const worktree = config.worktrees[worktreeId] || null;
  const diffBase = options.diffBase || (worktree && worktree.base_ref) || null;
  const includePaths = normalizeList(options.includePaths);
  const unsafePaths = normalizeList(options.unsafePaths);
  const allowedUnsafePaths = normalizeList(options.allowedUnsafePaths);
  const result = changedFiles(worktree, diffBase);
  const allChangedFiles = result.files;
  const patchFiles = includePaths.length
    ? allChangedFiles.filter(file => pathMatchesAny(file, includePaths))
    : allChangedFiles;
  const ignoredFiles = includePaths.length
    ? allChangedFiles.filter(file => !pathMatchesAny(file, includePaths))
    : [];
  const rawUnsafeFiles = allChangedFiles.filter(file => pathMatchesAny(file, unsafePaths));
  const allowedUnsafeFiles = allowedUnsafePaths.length
    ? rawUnsafeFiles.filter(file => pathMatchesAny(file, allowedUnsafePaths))
    : [];
  const unsafeFiles = allowedUnsafePaths.length
    ? rawUnsafeFiles.filter(file => !pathMatchesAny(file, allowedUnsafePaths))
    : rawUnsafeFiles;
  return {
    worktree: worktreeId || null,
    diff_base: diffBase,
    include_paths: includePaths,
    unsafe_paths: unsafePaths,
    allowed_unsafe_paths: allowedUnsafePaths,
    changed_files: allChangedFiles,
    changed_file_count: allChangedFiles.length,
    patch_files: patchFiles,
    patch_file_count: patchFiles.length,
    ignored_files: ignoredFiles,
    raw_unsafe_files: rawUnsafeFiles,
    allowed_unsafe_files: allowedUnsafeFiles,
    unsafe_files: unsafeFiles,
    unsafe_file_count: unsafeFiles.length,
    safe_for_overlay: !result.error && unsafeFiles.length === 0,
    error: result.error,
  };
}

function resolveTemplate(template, values) {
  if (!template) return null;
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    return Object.prototype.hasOwnProperty.call(values, key) && values[key] != null
      ? String(values[key])
      : '';
  });
}

function posixJoin(...parts) {
  return path.posix.join(...parts.map(part => String(part || '').replace(/\\/g, '/')));
}

function safeContextId(value) {
  return String(value || 'image-build')
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160) || 'image-build';
}

function imageSpecFromProfile(config, profile, profileName, workspaceSet, sourceHeads) {
  const builderName = profile.builder || null;
  const builder = builderName ? config.builders[builderName] || null : null;
  const scalarImageName = typeof profile.image === 'string' ? profile.image : null;
  const imageSpec = profile.image && typeof profile.image === 'object' && !Array.isArray(profile.image)
    ? profile.image
    : {};
  const primaryWorktree = imageSpec.primary_worktree ||
    (profile.vllm && profile.vllm.worktree) ||
    null;
  const primary = primaryWorktree
    ? sourceHeads.find(item => item.id === primaryWorktree) || null
    : sourceHeads[0] || null;
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const tagTemplate = imageSpec.tag_template || profile.tag_template || null;
  const computedTag = tagTemplate
    ? resolveTemplate(tagTemplate, {
      date,
      profile: profileName,
      track: workspaceSet,
      workspace_set: workspaceSet,
      primary_short_sha: primary ? primary.head : null,
      primary_head: primary ? primary.head : null,
    })
    : null;
  const registry = profile.registry || imageSpec.registry || (builder && builder.registry) || null;
  const imageName = scalarImageName || imageSpec.repository || imageSpec.name || null;
  const tag = profile.tag || imageSpec.tag || computedTag || null;
  return {
    registry,
    image_name: imageName,
    tag,
    image: imageName && tag ? (registry ? `${registry}/${imageName}:${tag}` : `${imageName}:${tag}`) : null,
    tag_template: tagTemplate,
    primary_worktree: primaryWorktree,
  };
}

function missingAdvancedFields(config, profile, imageSpec) {
  const missing = [];
  const gates = profile.gates || {};
  const mode = profile.mode || null;
  const builderName = profile.builder || null;
  const vllm = profile.vllm || {};
  const pegaflow = profile.pegaflow || {};
  const build = profile.build || {};

  if (!mode) missing.push('mode');
  if (!builderName) missing.push('builder');
  if (builderName && !config.builders[builderName]) missing.push(`builders.${builderName}`);
  if (!imageSpec.registry) missing.push('image.registry');
  if (!imageSpec.image_name) missing.push('image.repository');
  if (!imageSpec.tag) missing.push('image.tag_or_tag_template');

  if (!vllm.worktree) missing.push('vllm.worktree');
  if (vllm.worktree && !config.worktrees[vllm.worktree]) missing.push(`worktrees.${vllm.worktree}`);
  if (mode === 'tag_patch_image') {
    if (!vllm.base_image) missing.push('vllm.base_image');
    if (vllm.base_image && /<[^>]+>/.test(String(vllm.base_image))) missing.push('vllm.base_image_pinned_digest');
    if (vllm.base_image && !/@sha256:[a-f0-9]{64}$/i.test(String(vllm.base_image))) missing.push('vllm.base_image_pinned_digest');
    if (!(vllm.patch && vllm.patch.diff_base) && !vllm.base_ref && !(vllm.worktree && config.worktrees[vllm.worktree] && config.worktrees[vllm.worktree].base_ref)) {
      missing.push('vllm.patch.diff_base');
    }
  }
  if (mode === 'full_source_image') {
    if (!build.dockerfile && !(vllm.build && vllm.build.dockerfile)) missing.push('build.dockerfile');
    if (!build.context && !(vllm.build && vllm.build.context)) missing.push('build.context');
  }

  if (pegaflow.required === true) {
    if (!pegaflow.worktree) missing.push('pegaflow.worktree');
    if (pegaflow.worktree && !config.worktrees[pegaflow.worktree]) missing.push(`worktrees.${pegaflow.worktree}`);
    if (!pegaflow.install_mode) missing.push('pegaflow.install_mode');
    if (pegaflow.install_mode === 'pypi_wheel_plus_overlay' && !pegaflow.package) {
      missing.push('pegaflow.package');
    }
    if (pegaflow.install_mode === 'source_wheel') {
      if (!(pegaflow.source_wheel && pegaflow.source_wheel.build_script)) missing.push('pegaflow.source_wheel.build_script');
      if (!(pegaflow.source_wheel && pegaflow.source_wheel.wheel_glob)) missing.push('pegaflow.source_wheel.wheel_glob');
    }
  }

  if (gates.require_remote_validation === true && !profile.workspace_set) {
    missing.push('workspace_set');
  }

  return missing;
}

function buildStrategy(config, profileName, profile, imageSpec, sourceHeads, vllmPatch, pegaflowPatch) {
  const builderName = profile.builder || null;
  const builder = builderName ? config.builders[builderName] || {} : {};
  const mode = profile.mode || null;
  const vllm = profile.vllm || {};
  const pegaflow = profile.pegaflow || {};
  const build = profile.build || {};
  const contextId = safeContextId(`${profileName}-${imageSpec.tag || 'untagged'}`);
  const remoteContext = builder.work_root
    ? posixJoin(builder.work_root, contextId)
    : null;
  const common = {
    mode,
    builder: builderName,
    remote_context: remoteContext,
    local_plan_artifacts: [
      'source-heads.json',
      'patch-manifest.json',
      'Dockerfile.devteam',
      'verify.sh',
    ],
    source_heads: sourceHeads.map(item => ({
      id: item.id,
      repo: item.repo,
      branch: item.branch,
      head: item.head,
      base_ref: item.base_ref,
    })),
    final_image: imageSpec.image,
    verify_commands: normalizeList(profile.verify && profile.verify.commands),
    record_after_build: {
      kind: 'image-build',
      require_digest: true,
      require_log: true,
    },
  };

  if (mode === 'tag_patch_image') {
    const runtimePipPackages = normalizeList(vllm.runtime_pip_packages || vllm.extra_pip_packages);
    const steps = [
      `FROM ${vllm.base_image || '<vllm.base_image>'}`,
      'COPY overlays/vllm /tmp/devteam-overlays/vllm',
      'RUN python3 /tmp/devteam-overlays/vllm/apply_vllm_overlay.py',
    ];
    if (runtimePipPackages.length) {
      steps.push(`RUN python3 -m pip install --no-cache-dir ${runtimePipPackages.join(' ')}`);
    }
    if (pegaflow.required === true && pegaflow.install_mode === 'pypi_wheel_plus_overlay') {
      steps.push(`RUN python3 -m pip install --no-cache-dir ${pegaflow.package || '<pegaflow.package>'}`);
      steps.push('COPY overlays/pegaflow /tmp/devteam-overlays/pegaflow');
      steps.push('RUN python3 /tmp/devteam-overlays/pegaflow/apply_pegaflow_overlay.py');
    }
    return {
      ...common,
      base_image: vllm.base_image || null,
      platform: vllm.platform || null,
      overlay_policy: {
        vllm_safe_paths: vllmPatch ? vllmPatch.include_paths : [],
        vllm_unsafe_paths: vllmPatch ? vllmPatch.unsafe_paths : DEFAULT_VLLM_UNSAFE_PATCH_PATHS,
        ignored_paths_are_not_image_inputs: true,
      },
      materialize_inputs: {
        vllm_overlay_files: vllmPatch ? vllmPatch.patch_files : [],
        vllm_ignored_files: vllmPatch ? vllmPatch.ignored_files : [],
        vllm_runtime_pip_packages: runtimePipPackages,
        vllm_allowed_unsafe_files: vllmPatch ? vllmPatch.allowed_unsafe_files : [],
        pegaflow_install_mode: pegaflow.install_mode || null,
        pegaflow_package: pegaflow.package || null,
        pegaflow_overlay_files: pegaflowPatch ? pegaflowPatch.patch_files : [],
      },
      dockerfile_outline: steps,
      next_executor_shape: [
        'materialize overlay files into remote_context/overlays',
        'write Dockerfile.devteam and patch-manifest.json',
        'docker build the generated context with the planned image tag',
        'run verify commands inside the built image',
        'push image and record image digest in the run',
      ],
    };
  }

  if (mode === 'full_source_image') {
    const vllmBuild = vllm.build || {};
    const context = build.context || vllmBuild.context || null;
    const dockerfile = build.dockerfile || vllmBuild.dockerfile || null;
    const target = build.target || vllmBuild.target || 'vllm-openai';
    const bakeFiles = normalizeList(build.bake_files || vllmBuild.bake_files);
    return {
      ...common,
      source_build: {
        context,
        dockerfile,
        target,
        bake_files: bakeFiles,
        worktree: vllm.worktree || null,
      },
      materialize_inputs: {
        source_worktrees: sourceHeads.map(item => item.id),
        pegaflow_install_mode: pegaflow.install_mode || null,
        pegaflow_source_wheel: pegaflow.source_wheel || null,
      },
      dockerfile_outline: bakeFiles.length
        ? [`docker buildx bake -f ${bakeFiles.join(' -f ')} ${target}`]
        : [`docker build -f ${dockerfile || '<dockerfile>'} --target ${target} -t ${imageSpec.image || '<image>'} ${context || '<context>'}`],
      next_executor_shape: [
        'sync exact source worktree heads to the build server',
        'build vLLM from the configured Dockerfile target',
        'install optional source-built component wheels',
        'run verify commands inside the built image',
        'push image and record image digest in the run',
      ],
    };
  }

  return common;
}

function ensureInside(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    error(`Refusing to write outside workspace: ${target}`);
  }
}

function copyFileIntoContext(srcRoot, relativeFile, dstRoot) {
  const src = path.join(srcRoot, relativeFile);
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
    return { file: relativeFile, status: 'missing', source: src };
  }
  const dst = path.join(dstRoot, relativeFile);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return { file: relativeFile, status: 'copied', source: src, target: dst };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function renderVerifyScript(commands) {
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
  ];
  for (const command of commands || []) {
    lines.push(String(command));
  }
  return `${lines.join('\n')}\n`;
}

function renderTagPatchApplyScript(packageName) {
  return [
    'import os',
    'import shutil',
    'import site',
    'import sysconfig',
    '',
    `package = ${JSON.stringify(packageName)}`,
    'src_root = os.path.dirname(__file__)',
    'candidates = []',
    'try:',
    '    candidates.extend(site.getsitepackages())',
    'except Exception:',
    '    pass',
    'purelib = sysconfig.get_paths().get("purelib")',
    'if purelib:',
    '    candidates.append(purelib)',
    'target_root = None',
    'for base in candidates:',
    '    candidate = os.path.join(base, package)',
    '    if os.path.isdir(candidate):',
    '        target_root = candidate',
    '        break',
    'if target_root is None:',
    '    raise SystemExit(f"package target not found for {package!r}; checked {candidates}")',
    'for current, _dirs, files in os.walk(src_root):',
    '    for name in files:',
    '        if name.startswith("apply_") and name.endswith("_overlay.py"):',
    '            continue',
    '        src = os.path.join(current, name)',
    '        rel = os.path.relpath(src, src_root)',
    '        dst = os.path.join(target_root, rel)',
    '        os.makedirs(os.path.dirname(dst), exist_ok=True)',
    '        shutil.copy2(src, dst)',
    '        print(f"overlay {package}/{rel}")',
    '',
  ].join('\n');
}

function renderTagPatchDockerfile(plan) {
  const lines = [];
  lines.push(`FROM ${plan.strategy.base_image}`);
  if (plan.strategy.platform) {
    lines.push(`LABEL devteam.platform=${JSON.stringify(plan.strategy.platform)}`);
  }
  lines.push('COPY overlays/vllm /tmp/devteam-overlays/vllm');
  lines.push('RUN python3 /tmp/devteam-overlays/vllm/apply_vllm_overlay.py');
  const runtimePipPackages = normalizeList(
    plan.strategy &&
    plan.strategy.materialize_inputs &&
    plan.strategy.materialize_inputs.vllm_runtime_pip_packages
  );
  if (runtimePipPackages.length) {
    lines.push(`RUN python3 -m pip install --no-cache-dir ${runtimePipPackages.join(' ')}`);
  }
  if (plan.pegaflow && plan.pegaflow.required && plan.pegaflow.install_mode === 'pypi_wheel_plus_overlay') {
    lines.push(`RUN python3 -m pip install --no-cache-dir ${plan.pegaflow.package}`);
    lines.push('COPY overlays/pegaflow /tmp/devteam-overlays/pegaflow');
    lines.push('RUN python3 /tmp/devteam-overlays/pegaflow/apply_pegaflow_overlay.py');
  }
  lines.push('COPY verify.sh /tmp/devteam-verify.sh');
  lines.push('RUN chmod +x /tmp/devteam-verify.sh');
  return `${lines.join('\n')}\n`;
}

function renderFullSourceDockerfile(plan) {
  const source = plan.strategy.source_build || {};
  return [
    '# This context is a planning artifact for a full source build.',
    '# The executor should sync the exact source worktree head, then run:',
    `# docker build -f ${source.dockerfile || '<dockerfile>'} --target ${source.target || '<target>'} -t ${plan.image || '<image>'} ${source.context || '<context>'}`,
    '',
  ].join('\n');
}

function materializeImagePlan(options = {}) {
  const plan = imagePlan(options);
  const config = loadWorkspaceConfig(options.root || null);
  const root = config.root;
  const contextRoot = options.output
    ? path.resolve(root, options.output)
    : path.join(root, '.devteam', 'image-contexts', safeContextId(`${plan.profile}-${plan.tag || 'untagged'}`));
  ensureInside(root, contextRoot);
  if (!plan.complete) {
    error(`Image profile is incomplete or unsafe: ${(plan.blocked_by || []).join(', ') || 'plan_not_complete'}`);
  }
  fs.mkdirSync(contextRoot, { recursive: true });

  const artifacts = [];
  const sourceHeadsPath = path.join(contextRoot, 'source-heads.json');
  writeJson(sourceHeadsPath, plan.source_heads || []);
  artifacts.push(sourceHeadsPath);
  const manifestPath = path.join(contextRoot, 'patch-manifest.json');
  writeJson(manifestPath, {
    profile: plan.profile,
    workspace_set: plan.workspace_set,
    mode: plan.mode,
    image: plan.image,
    vllm: plan.vllm,
    pegaflow: plan.pegaflow,
    strategy: plan.strategy,
  });
  artifacts.push(manifestPath);
  const verifyPath = path.join(contextRoot, 'verify.sh');
  fs.writeFileSync(verifyPath, renderVerifyScript(plan.strategy ? plan.strategy.verify_commands : []), { mode: 0o755 });
  artifacts.push(verifyPath);

  const copyResults = [];
  if (plan.mode === 'tag_patch_image') {
    const vllmEntry = plan.vllm && plan.vllm.worktree ? config.worktrees[plan.vllm.worktree] : null;
    const vllmOverlayRoot = path.join(contextRoot, 'overlays', 'vllm');
    if (vllmEntry) {
      for (const file of (plan.vllm.patch && plan.vllm.patch.patch_files) || []) {
        copyResults.push({ component: 'vllm', ...copyFileIntoContext(path.join(vllmEntry.abs_path, 'vllm'), file.replace(/^vllm\//, ''), vllmOverlayRoot) });
      }
    }
    fs.writeFileSync(path.join(vllmOverlayRoot, 'apply_vllm_overlay.py'), renderTagPatchApplyScript('vllm'), 'utf8');
    artifacts.push(path.join(vllmOverlayRoot, 'apply_vllm_overlay.py'));

    if (plan.pegaflow && plan.pegaflow.required && plan.pegaflow.worktree) {
      const pegaEntry = config.worktrees[plan.pegaflow.worktree] || null;
      const pegaOverlayRoot = path.join(contextRoot, 'overlays', 'pegaflow');
      if (pegaEntry) {
        for (const file of (plan.pegaflow.overlay && plan.pegaflow.overlay.patch_files) || []) {
          copyResults.push({ component: 'pegaflow', ...copyFileIntoContext(path.join(pegaEntry.abs_path, 'python', 'pegaflow'), file.replace(/^python\/pegaflow\//, ''), pegaOverlayRoot) });
        }
      }
      fs.writeFileSync(path.join(pegaOverlayRoot, 'apply_pegaflow_overlay.py'), renderTagPatchApplyScript('pegaflow'), 'utf8');
      artifacts.push(path.join(pegaOverlayRoot, 'apply_pegaflow_overlay.py'));
    }
    const dockerfilePath = path.join(contextRoot, 'Dockerfile.devteam');
    fs.writeFileSync(dockerfilePath, renderTagPatchDockerfile(plan), 'utf8');
    artifacts.push(dockerfilePath);
  } else if (plan.mode === 'full_source_image') {
    const dockerfilePath = path.join(contextRoot, 'Dockerfile.devteam');
    fs.writeFileSync(dockerfilePath, renderFullSourceDockerfile(plan), 'utf8');
    artifacts.push(dockerfilePath);
  }

  const copied = copyResults.filter(item => item.status === 'copied').length;
  const missing = copyResults.filter(item => item.status === 'missing').length;
  return {
    action: 'image_prepare',
    profile: plan.profile,
    workspace_set: plan.workspace_set,
    mode: plan.mode,
    image: plan.image,
    context_dir: contextRoot,
    remote_context: plan.strategy ? plan.strategy.remote_context : null,
    artifacts,
    copy_results: copyResults,
    totals: {
      copied,
      missing,
      artifacts: artifacts.length,
    },
    plan,
    next_action: missing > 0
      ? 'Some planned overlay files were missing. Review copy_results before building.'
      : 'Review the prepared context. This command did not run Docker or push images.',
  };
}

function gateStatus(run, kinds, options = {}) {
  const required = options.required !== false;
  if (!required) {
    return {
      required: false,
      status: 'not_required',
      required_kinds: kinds,
      next_action: 'This gate is not required by the build profile.',
    };
  }
  if (!run) {
    return {
      required: true,
      status: 'blocked',
      required_kinds: kinds,
      reason: 'run_required',
      next_action: `Pass --run <run-id> with passing evidence for: ${kinds.join(', ')}`,
    };
  }
  return {
    required: true,
    ...gateFromRun(run, kinds, options),
  };
}

function gateFromRun(run, requiredKinds, options = {}) {
  if (!run) return null;
  const sessionHeads = sessionWorktreeHeads(options.session || null);
  const currentWorktrees = Array.isArray(options.currentWorktrees) ? options.currentWorktrees : null;
  const required = requiredKinds.map(kind => {
    const event = run.latest[kind] || null;
    const headCheck = event && currentWorktrees
      ? compareWorktreeHeads(
        Object.keys(eventWorktreeHeads(event)).length ? eventWorktreeHeads(event) : sessionHeads,
        currentWorktrees
      )
      : null;
    const headOk = !headCheck || headCheck.status !== 'changed';
    return {
      kind,
      status: event ? event.status : 'missing',
      ok: Boolean(event && event.status === 'passed' && headOk),
      summary: event ? event.summary : null,
      head_status: headCheck ? (headCheck.status === 'changed' ? 'stale' : headCheck.status) : 'not_checked',
      head_changes: headCheck ? headCheck.changes : [],
    };
  });
  const blocked = required.filter(item => !item.ok);
  const headChanges = [];
  for (const item of required) {
    for (const change of item.head_changes || []) {
      headChanges.push({ kind: item.kind, ...change });
    }
  }
  return {
    run_id: run.run_id,
    status: blocked.length === 0 ? 'ready' : 'blocked',
    required,
    head_check: {
      status: headChanges.length > 0 ? 'changed' : (currentWorktrees ? 'current' : 'not_checked'),
      changes: headChanges,
    },
    next_action: blocked.length === 0
      ? 'Required run evidence is present. Review the plan before executing the next stage.'
      : (headChanges.length > 0
        ? 'worktree_head_changed: re-run sync/test for the current HEAD or start a new run.'
        : `Record passing evidence for: ${blocked.map(item => item.kind).join(', ')}`),
  };
}

function resolveBuildProfile(config, parsed) {
  const resolvedSet = resolveWorkspaceSet(config, parsed.set || null, { required: false });
  const trackProfile = resolvedSet.value
    ? inferTrackProfile(config, resolvedSet.value, { activeTrack: resolvedSet.value })
    : null;
  const name = parsed.profile ||
    (trackProfile ? trackProfile.build : null) ||
    config.defaults.build ||
    parsed.set ||
    resolvedSet.value;
  if (!name) error('No build profile specified. Pass --profile <name> or set defaults.workspace_set.');
  const profile = config.build_profiles[name];
  if (!profile) {
    error(`Unknown build profile '${name}'. Available: ${Object.keys(config.build_profiles).join(', ') || '(none)'}`);
  }
  return { name, profile };
}

function imagePlan(options = {}) {
  const config = loadWorkspaceConfig(options.root || null);
  const { name, profile } = resolveBuildProfile(config, {
    profile: options.profile || null,
    set: options.set || null,
  });
  const advanced = Boolean(
    profile.mode ||
    profile.builder ||
    profile.vllm ||
    profile.pegaflow ||
    profile.build ||
    (profile.image && typeof profile.image === 'object' && !Array.isArray(profile.image))
  );
  const envName = advanced ? (profile.env || null) : (profile.env || config.defaults.env || null);
  const env = envName ? config.env_profiles[envName] || null : null;
  const command = profile.command || null;
  const run = readRunEvents(config, options.run || null);
  const resolvedSet = resolveWorkspaceSet(config, options.set || profile.workspace_set || null, { required: false });
  const workspaceSet = profile.workspace_set || resolvedSet.value || name;

  if (!advanced) {
    const registry = profile.registry || (env && env.registry) || null;
    const imageName = profile.image || null;
    const tag = profile.tag || null;
    const image = imageName && tag
      ? (registry ? `${registry}/${imageName}:${tag}` : `${imageName}:${tag}`)
      : null;

    return {
      profile: name,
      workspace_set: workspaceSet,
      env: envName,
      registry,
      image_name: imageName,
      tag,
      image,
      command,
      recipe: profile.recipe || (profile.build && profile.build.recipe) || null,
      build_chain_doc: profile.build_chain_doc || null,
      complete: Boolean(image && command),
      run_gate: gateFromRun(run, ['sync', 'test']),
      notes: profile.notes || null,
      next_action: image && command
        ? 'Run the build command only after sync and remote environment checks pass.'
        : 'Fill build profile image/tag/command after choosing the concrete build recipe.',
    };
  }

  const sourceHeads = currentWorktreeHeads(config, workspaceSet);
  const imageSpec = imageSpecFromProfile(config, profile, name, workspaceSet, sourceHeads);
  const gatesConfig = profile.gates || {};
  const runSession = readRunSession(run);
  const remoteValidationGate = gateStatus(run, ['sync', 'test'], {
    required: gatesConfig.require_remote_validation !== false,
    session: runSession,
    currentWorktrees: sourceHeads,
  });
  const publishGate = gateStatus(run, ['publish'], {
    required: gatesConfig.require_publish === true,
    session: runSession,
    currentWorktrees: sourceHeads,
  });
  const vllm = profile.vllm || {};
  const vllmPatchConfig = vllm.patch || {};
  const vllmPatch = vllm.worktree
    ? patchAssessment(config, vllm.worktree, {
      diffBase: vllmPatchConfig.diff_base || vllm.base_ref || null,
      includePaths: normalizeList(vllmPatchConfig.include_paths).length
        ? vllmPatchConfig.include_paths
        : ['vllm/'],
      unsafePaths: normalizeList(vllmPatchConfig.unsafe_paths).length
        ? vllmPatchConfig.unsafe_paths
        : DEFAULT_VLLM_UNSAFE_PATCH_PATHS,
      allowedUnsafePaths: vllmPatchConfig.allowed_unsafe_paths || [],
    })
    : null;
  const pegaflow = profile.pegaflow || {};
  const pegaflowOverlayConfig = pegaflow.overlay || {};
  const pegaflowPatch = pegaflow.worktree
    ? patchAssessment(config, pegaflow.worktree, {
      diffBase: pegaflowOverlayConfig.diff_base || pegaflow.base_ref || null,
      includePaths: normalizeList(pegaflowOverlayConfig.paths).length
        ? pegaflowOverlayConfig.paths
        : ['python/pegaflow/'],
      unsafePaths: normalizeList(pegaflowOverlayConfig.unsafe_paths).length
        ? pegaflowOverlayConfig.unsafe_paths
        : DEFAULT_PEGAFLOW_UNSAFE_OVERLAY_PATHS,
    })
    : null;
  const missing = missingAdvancedFields(config, profile, imageSpec);
  const unsafePatchFiles = uniqueList([
    ...(profile.mode === 'tag_patch_image' && vllmPatch ? vllmPatch.unsafe_files : []),
    ...(pegaflow.install_mode === 'pypi_wheel_plus_overlay' && pegaflowPatch ? pegaflowPatch.unsafe_files.map(file => `pegaflow:${file}`) : []),
  ]);
  const blockedBy = [
    missing.length > 0 ? 'profile_incomplete' : null,
    remoteValidationGate.status === 'blocked' ? 'remote_validation_gate' : null,
    publishGate.status === 'blocked' ? 'publish_gate' : null,
    unsafePatchFiles.length > 0 ? 'unsafe_patch_files' : null,
    vllmPatch && vllmPatch.error ? vllmPatch.error : null,
    pegaflowPatch && pegaflowPatch.error ? `pegaflow:${pegaflowPatch.error}` : null,
  ].filter(Boolean);
  const complete = missing.length === 0 && unsafePatchFiles.length === 0 &&
    !(vllmPatch && vllmPatch.error) &&
    !(pegaflowPatch && pegaflowPatch.error);
  const ready = complete &&
    remoteValidationGate.status !== 'blocked' &&
    publishGate.status !== 'blocked';
  const strategy = buildStrategy(config, name, profile, imageSpec, sourceHeads, vllmPatch, pegaflowPatch);

  return {
    profile: name,
    workspace_set: workspaceSet,
    env: envName,
    builder: profile.builder || null,
    builder_profile: profile.builder ? config.builders[profile.builder] || null : null,
    mode: profile.mode || null,
    registry: imageSpec.registry,
    image_name: imageSpec.image_name,
    tag: imageSpec.tag,
    image: imageSpec.image,
    tag_template: imageSpec.tag_template,
    command,
    recipe: profile.recipe || (profile.build && profile.build.recipe) || null,
    build_chain_doc: profile.build_chain_doc || null,
    build: profile.build || {},
    strategy,
    verify: profile.verify || {},
    source_heads: sourceHeads,
    gates: {
      remote_validation: remoteValidationGate,
      publish: publishGate,
    },
    run_gate: remoteValidationGate.required ? remoteValidationGate : null,
    missing,
    blocked_by: blockedBy,
    vllm: {
      worktree: vllm.worktree || null,
      base_ref: vllm.base_ref || (vllm.worktree && config.worktrees[vllm.worktree] ? config.worktrees[vllm.worktree].base_ref : null),
      base_image: vllm.base_image || null,
      patch: vllmPatch,
    },
    pegaflow: {
      required: pegaflow.required === true,
      worktree: pegaflow.worktree || null,
      install_mode: pegaflow.install_mode || null,
      package: pegaflow.package || null,
      overlay: pegaflowPatch,
      source_wheel: pegaflow.source_wheel || null,
    },
    unsafe_patch_files: unsafePatchFiles,
    complete,
    ready,
    status: missing.length > 0
      ? 'incomplete'
      : (ready ? 'ready' : 'blocked'),
    notes: profile.notes || null,
    next_action: missing.length > 0
      ? `Fill build profile fields: ${missing.join(', ')}`
      : (unsafePatchFiles.length > 0
        ? 'Unsafe patch files detected for the selected build mode. Switch to full_source_image or narrow the source changes.'
        : (ready
          ? 'Build contract is ready. Review the generated plan before adding or running a concrete build executor.'
          : 'Resolve blocked gates before image build. This command does not execute Docker.')),
  };
}

function resolveDeployFlow(config, parsed) {
  const resolvedSet = resolveWorkspaceSet(config, parsed.set || null, {
    required: true,
    label: 'deploy workspace set',
  });
  const setName = resolvedSet.value;
  const trackProfile = inferTrackProfile(config, setName, { activeTrack: setName });
  const flowName = parsed.flow || trackProfile.deploy_flow || config.defaults.deploy_flow || setName;
  const profileName = parsed.profile || trackProfile.deploy || config.defaults.deploy;
  if (!setName) error('No workspace set specified. Pass --set <name> or set defaults.workspace_set.');
  if (!profileName) error('No deploy profile specified. Pass --profile <name> or set defaults.deploy.');
  const deployProfile = config.deploy_profiles[profileName];
  if (!deployProfile) {
    error(`Unknown deploy profile '${profileName}'. Available: ${Object.keys(config.deploy_profiles).join(', ') || '(none)'}`);
  }
  const flow = config.deploy_flows[flowName] || {};
  return { setName, flowName, profileName, deployProfile, flow };
}

function deployPlan(options = {}) {
  const config = loadWorkspaceConfig(options.root || null);
  const { setName, flowName, profileName, deployProfile, flow } = resolveDeployFlow(config, {
    set: options.set || null,
    flow: options.flow || null,
    profile: options.profile || null,
  });
  const run = readRunEvents(config, options.run || null);

  return {
    workspace_set: setName,
    deploy_flow: flowName,
    profile: profileName,
    type: deployProfile.type || 'unknown',
    namespace: deployProfile.namespace || null,
    env: deployProfile.env || null,
    commands: flow.commands || {},
    guide: flow.guide || null,
    gateway_recipe: flow.gateway_recipe || null,
    enabled: deployProfile.enabled !== false,
    complete: Boolean(deployProfile.namespace || Object.keys(flow.commands || {}).length),
    run_gate: gateFromRun(run, ['image-build']),
    verify_gate: gateFromRun(run, ['deploy']),
    next_action: Object.keys(flow.commands || {}).length
      ? 'Review commands and run env_check/prereqs before deploy. This command does not mutate the cluster.'
      : 'Fill deploy flow commands after choosing the concrete pre-production target.',
  };
}

function recordImageResult(options = {}) {
  const config = loadWorkspaceConfig(options.root || null);
  const profileName = options.profile || null;
  if (profileName && !config.build_profiles[profileName]) {
    error(`Unknown build profile '${profileName}'. Available: ${Object.keys(config.build_profiles).join(', ') || '(none)'}`);
  }
  const profilePatch = profileName ? { build: String(profileName) } : null;
  const status = options.status || 'passed';
  const image = options.image || null;
  const digest = options.digest || null;
  const summary = options.summary ||
    `image build ${status}${image ? `: ${image}` : ''}${digest ? ` @ ${digest}` : ''}`;
  const { recordSessionEvent } = require('./session-manager.cjs');
  return recordSessionEvent({
    root: config.root,
    run: options.run,
    set: options.set || null,
    allowCrossTrack: options.allowCrossTrack === true,
    allowStaleHead: options.allowStaleHead === true,
    kind: 'image-build',
    status,
    summary,
    command: options.command || null,
    log: options.log || null,
    artifact: options.artifact || null,
    notes: [
      image ? `image=${image}` : null,
      digest ? `digest=${digest}` : null,
      options.notes || null,
    ].filter(Boolean).join('; ') || null,
    profilePatch,
  });
}

function recordDeployResult(options = {}) {
  const config = loadWorkspaceConfig(options.root || null);
  const profileName = options.profile || null;
  if (profileName && !config.deploy_profiles[profileName]) {
    error(`Unknown deploy profile '${profileName}'. Available: ${Object.keys(config.deploy_profiles).join(', ') || '(none)'}`);
  }
  const profilePatch = profileName ? { deploy: String(profileName) } : null;
  const status = options.status || 'passed';
  const target = options.target || options.namespace || options.profile || null;
  const summary = options.summary || `deploy ${status}${target ? `: ${target}` : ''}`;
  const { recordSessionEvent } = require('./session-manager.cjs');
  return recordSessionEvent({
    root: config.root,
    run: options.run,
    set: options.set || null,
    allowCrossTrack: options.allowCrossTrack === true,
    allowStaleHead: options.allowStaleHead === true,
    kind: 'deploy',
    status,
    summary,
    command: options.command || null,
    log: options.log || null,
    artifact: options.artifact || null,
    notes: [
      options.namespace ? `namespace=${options.namespace}` : null,
      options.image ? `image=${options.image}` : null,
      options.notes || null,
    ].filter(Boolean).join('; ') || null,
    profilePatch,
  });
}

function recordDeployVerifyResult(options = {}) {
  const config = loadWorkspaceConfig(options.root || null);
  const profileName = options.profile || null;
  if (profileName && !config.deploy_profiles[profileName]) {
    error(`Unknown deploy profile '${profileName}'. Available: ${Object.keys(config.deploy_profiles).join(', ') || '(none)'}`);
  }
  const profilePatch = profileName ? { deploy: String(profileName) } : null;
  const status = options.status || 'passed';
  const target = options.target || options.namespace || options.profile || null;
  const summary = options.summary || `preprod verification ${status}${target ? `: ${target}` : ''}`;
  const { recordSessionEvent } = require('./session-manager.cjs');
  return recordSessionEvent({
    root: config.root,
    run: options.run,
    set: options.set || null,
    allowCrossTrack: options.allowCrossTrack === true,
    allowStaleHead: options.allowStaleHead === true,
    kind: 'deploy-verify',
    status,
    summary,
    command: options.command || null,
    log: options.log || null,
    artifact: options.artifact || null,
    notes: [
      options.namespace ? `namespace=${options.namespace}` : null,
      options.image ? `image=${options.image}` : null,
      options.endpoint ? `endpoint=${options.endpoint}` : null,
      options.notes || null,
    ].filter(Boolean).join('; ') || null,
    profilePatch,
  });
}

function handleImagePlan(subcommand, args) {
  const parsed = parseArgs(args || []);
  if (!subcommand || subcommand === 'plan') {
    output(imagePlan({
      root: parsed.root || null,
      profile: parsed.profile || null,
      set: parsed.set || null,
      run: parsed.run || null,
    }));
    return;
  }
  if (subcommand === 'prepare') {
    output(materializeImagePlan({
      root: parsed.root || null,
      profile: parsed.profile || null,
      set: parsed.set || null,
      run: parsed.run || null,
      output: parsed.output || parsed.out || null,
    }));
    return;
  }
  if (subcommand === 'record') {
    output(recordImageResult({
      root: parsed.root || null,
      run: parsed.run || parsed.id || null,
      status: parsed.status || null,
      image: parsed.image || null,
      digest: parsed.digest || null,
      profile: parsed.profile || null,
      summary: parsed.summary || null,
      command: parsed.command || null,
      log: parsed.log || null,
      artifact: parsed.artifact || null,
      notes: parsed.notes || parsed.note || null,
      set: parsed.set || null,
      allowCrossTrack: parsed['allow-cross-track'] === true,
      allowStaleHead: parsed['allow-stale-head'] === true,
    }));
    return;
  }
  error(`Unknown image subcommand: '${subcommand}'. Use: plan, prepare, record`);
}

function handleDeployPlan(subcommand, args) {
  const parsed = parseArgs(args || []);
  if (!subcommand || subcommand === 'plan') {
    output(deployPlan({
      root: parsed.root || null,
      profile: parsed.profile || null,
      set: parsed.set || null,
      flow: parsed.flow || null,
      run: parsed.run || null,
    }));
    return;
  }
  if (subcommand === 'record') {
    output(recordDeployResult({
      root: parsed.root || null,
      run: parsed.run || parsed.id || null,
      status: parsed.status || null,
      target: parsed.target || null,
      namespace: parsed.namespace || null,
      profile: parsed.profile || null,
      image: parsed.image || null,
      summary: parsed.summary || null,
      command: parsed.command || null,
      log: parsed.log || null,
      artifact: parsed.artifact || null,
      notes: parsed.notes || parsed.note || null,
      set: parsed.set || null,
      allowCrossTrack: parsed['allow-cross-track'] === true,
      allowStaleHead: parsed['allow-stale-head'] === true,
    }));
    return;
  }
  if (subcommand === 'verify-record' || subcommand === 'record-verify') {
    output(recordDeployVerifyResult({
      root: parsed.root || null,
      run: parsed.run || parsed.id || null,
      status: parsed.status || null,
      target: parsed.target || null,
      namespace: parsed.namespace || null,
      profile: parsed.profile || null,
      image: parsed.image || null,
      endpoint: parsed.endpoint || null,
      summary: parsed.summary || null,
      command: parsed.command || null,
      log: parsed.log || null,
      artifact: parsed.artifact || null,
      notes: parsed.notes || parsed.note || null,
      set: parsed.set || null,
      allowCrossTrack: parsed['allow-cross-track'] === true,
      allowStaleHead: parsed['allow-stale-head'] === true,
    }));
    return;
  }
  error(`Unknown deploy subcommand: '${subcommand}'. Use: plan, record, verify-record`);
}

module.exports = {
  compareWorktreeHeads,
  deployPlan,
  gateFromRun,
  handleDeployPlan,
  handleImagePlan,
  imagePlan,
  materializeImagePlan,
  readRunEvents,
  recordDeployVerifyResult,
  recordDeployResult,
  recordImageResult,
};
