'use strict';

const fs = require('fs');
const path = require('path');

const { output, error, parseArgs, expandHome } = require('./core.cjs');
const { configPath, ensureLiteDirs } = require('./lite-config.cjs');

function quote(value) {
  if (value == null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(String(value));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeIfAllowed(filePath, content, options, written) {
  const exists = fs.existsSync(filePath);
  if (exists && options.force !== true) {
    written.push({ path: filePath, action: 'skipped', reason: 'exists' });
    return;
  }
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
  written.push({ path: filePath, action: exists ? 'overwritten' : 'created' });
}

function renderConfig(root, name) {
  return [
    'version: 2',
    `workspace: ${quote(root)}`,
    `name: ${quote(name)}`,
    '',
    'defaults:',
    '  workspace_set: "default"',
    '  env: "local"',
    '  sync: "local"',
    '  build: "image-build"',
    '  deploy: "preprod"',
    '  deploy_flow: "preprod-validation"',
    '',
    'repos: {}',
    '',
    'worktrees: {}',
    '',
    'workspace_sets:',
    '  default:',
    '    description: "Active repos/worktrees for the current validation track. Fill this after choosing concrete code targets."',
    '    worktrees: []',
    '',
    'env_profiles:',
    '  local:',
    '    type: "local"',
    '    notes: "Default profile before remote server details are chosen."',
    '  remote-test:',
    '    type: "remote_dev"',
    '    ssh: null',
    '    host: null',
    '    source_dir: null',
    '    venv: null',
    '    strategy: "rsync"',
    '    enabled: false',
    '  image-build:',
    '    type: "remote_dev"',
    '    ssh: null',
    '    host: null',
    '    work_dir: null',
    '    registry: null',
    '    strategy: "recipe"',
    '    enabled: false',
    '  preprod:',
    '    type: "k8s"',
    '    ssh: null',
    '    host: null',
    '    namespace: null',
    '    enabled: false',
    '',
    'build_profiles:',
    '  image-build:',
    '    workspace_set: "default"',
    '    env: "image-build"',
    '    registry: null',
    '    image: null',
    '    tag: null',
    '    command: null',
    '    recipe: ".devteam/recipes/image-build-loop.md"',
    '    notes: "Fill after selecting the concrete image recipe."',
    '',
    'deploy_profiles:',
    '  preprod:',
    '    type: "k8s"',
    '    env: "preprod"',
    '    namespace: null',
    '',
    'deploy_flows:',
    '  preprod-validation:',
    '    profile: "preprod"',
    '    guide: ".devteam/recipes/k8s-preprod-loop.md"',
    '    gateway_recipe: null',
    '    commands: {}',
    '',
    'workflow:',
    '  phases: ["local-dev", "remote-test", "image-build", "preprod-deploy", "knowledge-capture"]',
    '  source_of_truth: ".devteam/config.yaml plus recipes under .devteam/recipes"',
    '  mutable_state: ".devteam/state and .devteam/runs"',
    '',
    'knowledge:',
    '  recipes_dir: ".devteam/recipes"',
    '  wiki_dir: ".devteam/wiki"',
    '  skills_dir: ".devteam/skills"',
    '',
  ].join('\n');
}

function workspaceReadme(name) {
  return [
    `# ${name} Devteam Workspace`,
    '',
    'This workspace is intentionally a clean skeleton. Concrete repos, branches, build commands, remote venvs, and cluster targets should be added as profiles only after they are chosen.',
    '',
    '## Layout',
    '',
    '- `repos/`: local repo checkouts or worktrees. Keep code separate from devteam metadata.',
    '- `artifacts/`: generated build/deploy inputs that are worth keeping with the workspace.',
    '- `.devteam/config.yaml`: small declarative registry for worktrees, environments, build profiles, and deploy flows.',
    '- `.devteam/recipes/`: repeatable command recipes for the real workflow.',
    '- `.devteam/wiki/`: durable notes and decision records.',
    '- `.devteam/skills/`: reusable operational skills extracted from repeated work.',
    '- `.devteam/runs/`: timestamped run snapshots.',
    '- `.devteam/state/`: local mutable state; not the source of truth.',
    '',
    '## Intended Loop',
    '',
    '1. Edit code locally in one or more worktrees.',
    '2. Sync only the selected change set to a remote test environment.',
    '3. Run remote validation from a named profile.',
    '4. Build a versioned image from a named image profile.',
    '5. Deploy to a pre-production k8s target from a named deploy flow.',
    '6. Promote stable commands and lessons into recipes/wiki/skills.',
    '',
    'The skeleton avoids legacy `.dev.yaml` and project-specific `build.sh` assumptions. Those can be reintroduced as explicit recipes only when they are still useful.',
    '',
  ].join('\n');
}

function recipe(title, body) {
  return [`# ${title}`, '', body.trim(), ''].join('\n');
}

function scaffoldWorkspace(options = {}) {
  const root = path.resolve(expandHome(options.root || process.cwd()));
  const name = options.name || path.basename(root);
  const written = [];
  const cleaned = [];

  mkdirp(root);
  mkdirp(path.join(root, 'repos'));
  mkdirp(path.join(root, 'artifacts'));
  ensureLiteDirs(root);
  if (options.cleanLegacy === true) {
    const legacyKnowledge = path.join(root, '.devteam', 'knowledge');
    if (fs.existsSync(legacyKnowledge)) {
      fs.rmSync(legacyKnowledge, { recursive: true, force: true });
      cleaned.push({ path: legacyKnowledge, action: 'removed' });
    }
  }

  writeIfAllowed(configPath(root), renderConfig(root, name), options, written);
  writeIfAllowed(path.join(root, '.devteam', 'README.md'), workspaceReadme(name), options, written);
  writeIfAllowed(path.join(root, '.devteam', 'profiles', 'README.md'), recipe('Profiles', [
    'Use this directory for optional profile fragments and notes.',
    '',
    'The active machine-readable registry is `.devteam/config.yaml`.',
  ].join('\n')), options, written);
  writeIfAllowed(path.join(root, '.devteam', 'recipes', 'local-dev-loop.md'), recipe('Local Dev Loop', [
    'Purpose: define how local worktrees are selected, inspected, tested, and committed.',
    '',
    'Fill later:',
    '- repo/worktree naming convention',
    '- local test command policy',
    '- commit and push policy',
  ].join('\n')), options, written);
  writeIfAllowed(path.join(root, '.devteam', 'recipes', 'remote-test-loop.md'), recipe('Remote Test Loop', [
    'Purpose: define how local changes move to a remote test server and how validation runs there.',
    '',
    'Fill later:',
    '- remote SSH profile',
    '- remote source directory',
    '- runtime or venv activation',
    '- unit and end-to-end validation commands',
  ].join('\n')), options, written);
  writeIfAllowed(path.join(root, '.devteam', 'recipes', 'image-build-loop.md'), recipe('Image Build Loop', [
    'Purpose: define the exact image build contract once the recipe is chosen.',
    '',
    'Fill later:',
    '- build context location',
    '- base image policy',
    '- image name and versioning policy',
    '- dry-run/build/push/verify commands',
  ].join('\n')), options, written);
  writeIfAllowed(path.join(root, '.devteam', 'recipes', 'k8s-preprod-loop.md'), recipe('K8s Preprod Loop', [
    'Purpose: define how a verified image is deployed to a pre-production k8s target.',
    '',
    'Fill later:',
    '- cluster access profile',
    '- namespace and manifests',
    '- deploy, rollback, and verification commands',
  ].join('\n')), options, written);
  writeIfAllowed(path.join(root, '.devteam', 'recipes', 'knowledge-capture.md'), recipe('Knowledge Capture', [
    'Purpose: keep repeated fixes and operational lessons discoverable.',
    '',
    'Promote notes in this order:',
    '- one-off run details -> `.devteam/runs/`',
    '- repeatable command flow -> `.devteam/recipes/`',
    '- durable explanation or decision -> `.devteam/wiki/`',
    '- reusable agent behavior -> `.devteam/skills/`',
  ].join('\n')), options, written);
  writeIfAllowed(path.join(root, '.devteam', 'wiki', 'index.md'), [
    '# Wiki Index',
    '',
    'Add durable design notes, handoff summaries, and decisions here.',
    '',
    '## Seeds',
    '',
    '- Workspace architecture',
    '- Remote validation environments',
    '- Image versioning policy',
    '- Deployment verification checklist',
    '',
  ].join('\n'), options, written);
  writeIfAllowed(path.join(root, '.devteam', 'skills', 'README.md'), [
    '# Skills',
    '',
    'Add reusable operational skills here after a workflow has repeated enough times to deserve automation.',
    '',
  ].join('\n'), options, written);
  writeIfAllowed(path.join(root, '.devteam', 'runs', 'README.md'), [
    '# Runs',
    '',
    'Generated session snapshots belong here. Keep permanent lessons in recipes/wiki/skills instead.',
    '',
  ].join('\n'), options, written);

  return {
    action: 'workspace_scaffold',
    workspace: root,
    name,
    force: options.force === true,
    files: written,
    cleaned,
    next_action: 'Fill repos/worktrees and environment profiles only after the concrete repo, branch, remote server, build, and deploy choices are made.',
  };
}

function handleWorkspaceScaffold(subcommand, args) {
  const parsed = parseArgs(args || []);
  if (!subcommand || subcommand === 'scaffold') {
    output(scaffoldWorkspace({
      root: parsed.root || null,
      name: parsed.name || null,
      force: parsed.force === true,
      cleanLegacy: parsed['clean-legacy'] === true,
    }));
    return;
  }
  error(`Unknown workspace subcommand: '${subcommand}'. Use: scaffold`);
}

module.exports = {
  handleWorkspaceScaffold,
  scaffoldWorkspace,
};
