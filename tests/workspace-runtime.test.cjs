'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.resolve(__dirname, '..', 'lib', 'devteam.cjs');
const yaml = require('../lib/yaml.cjs');
const {
  buildVllmRefreshCommand,
  remoteChecksForProfile,
} = require('../lib/env-profile.cjs');

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function runCli(cwd, args) {
  const stdout = execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
  return JSON.parse(stdout);
}

function runCliWithEnv(cwd, args, env) {
  const stdout = execFileSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return JSON.parse(stdout);
}

function runCliText(cwd, args) {
  return execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
}

function runCliTextWithEnv(cwd, args, env) {
  return execFileSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function runCliFailure(cwd, args, env = {}) {
  try {
    execFileSync('node', [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    return {
      status: err.status,
      stdout: err.stdout ? String(err.stdout) : '',
      stderr: err.stderr ? String(err.stderr) : '',
    };
  }
  throw new Error(`Expected CLI failure for args: ${args.join(' ')}`);
}

function testYamlDoubleQuotedEscapesForShellCommands() {
  const parsed = yaml.parse([
    'verify:',
    '  commands:',
    '    - "python3 -c \\"import vllm; print(vllm.__version__)\\""',
    '    - "python3 -c \\"import tokenspeed_mla; print(tokenspeed_mla.__file__)\\""',
  ].join('\n') + '\n');

  assert.deepStrictEqual(parsed.verify.commands, [
    'python3 -c "import vllm; print(vllm.__version__)"',
    'python3 -c "import tokenspeed_mla; print(tokenspeed_mla.__file__)"',
  ]);
}

function createStandardWorkspace(prefix = 'devteam-workspace-new-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, 'repo-a-source'), { recursive: true });
  writeFile(path.join(root, 'build.sh'), '#!/usr/bin/env bash\n');
  writeFile(path.join(root, 'scripts', 'deploy.sh'), '#!/usr/bin/env bash\n');
  writeFile(path.join(root, 'Dockerfile.dev'), 'FROM scratch\n');

  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'repos:',
    '  repo-a:',
    '    remote: https://example.com/repo-a.git',
    'worktrees:',
    '  repo_a__feat_a:',
    '    repo: repo-a',
    '    path: repo-a-dev',
    '    source_path: repo-a-source',
    '    branch: main',
    '    base_ref: main',
    '    sync:',
    '      profile: build-server',
    '      remote_path: /remote/build/repo-a-dev',
    'workspace_sets:',
    '  feat-a:',
    '    description: Feature A',
    '    worktrees: ["repo_a__feat_a"]',
    'env_profiles:',
    '  build-server:',
    '    type: remote_dev',
    '    ssh: "ssh -p 2222 builder@example.com"',
    '    host: builder@example.com',
    '    work_dir: /remote/build',
    '    registry: registry.example.com/library',
    '  staging:',
    '    type: k8s',
    '    ssh: "ssh root@cluster.example.com"',
    '    host: cluster.example.com',
    '    namespace: llm-test',
    'build_profiles:',
    '  feat-a:',
    '    workspace_set: feat-a',
    '    env: build-server',
    '    command: bash build.sh --build-only',
    '    image: llm-d-cuda',
    '    tag: v1',
    'deploy_profiles:',
    '  staging:',
    '    type: k8s',
    '    env: staging',
    '    namespace: llm-test',
    'deploy_flows:',
    '  feat-a:',
    '    profile: staging',
    '    guide: staging-guide',
    '    gateway_recipe: agentgateway',
    '    commands:',
    '      env_check: ./scripts/check.sh',
    '      deploy: ./scripts/deploy.sh',
    'defaults:',
    '  workspace_set: feat-a',
    '  env: build-server',
    '  sync: build-server',
    '  build: feat-a',
    '  deploy: staging',
    '  deploy_flow: feat-a',
  ].join('\n') + '\n');

  return root;
}

function initGitRepo(repoPath) {
  fs.mkdirSync(repoPath, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoPath, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repoPath, 'README.md'), '# repo\n');
}

function testWorkspaceStatusShowsMissingAndSource() {
  const newRoot = createStandardWorkspace();

  const status = runCli(newRoot, ['ws', 'status', '--root', newRoot, '--set', 'feat-a']);
  assert.strictEqual(status.workspace_set, 'feat-a');
  assert.strictEqual(status.totals.worktrees, 1);
  assert.strictEqual(status.totals.missing, 1);
  assert.strictEqual(status.worktrees[0].source_exists, true);

  const text = runCliText(newRoot, ['ws', 'status', '--root', newRoot, '--set', 'feat-a', '--text']);
  assert.match(text, /Worktrees: 0\/1 present, 0 dirty, 1 missing/);
  assert.match(text, /source: .*present/);
}

function testWorkspaceStatusSurfacesPublishPlan() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-workspace-publish-'));
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__feature:',
    '    repo: repo-a',
    '    path: repo-a-feature',
    '    branch: feature',
    '    publish:',
    '      after_validation: true',
    '      remote: origin',
    '      branch: feature',
    '      status: local-only',
    'workspace_sets:',
    '  feature-a:',
    '    worktrees: ["repo_a__feature"]',
    'env_profiles:',
    '  local:',
    '    type: local',
    'defaults:',
    '  workspace_set: feature-a',
    '  env: local',
  ].join('\n') + '\n');

  const status = runCli(root, ['ws', 'status', '--root', root, '--set', 'feature-a']);
  assert.strictEqual(status.worktrees[0].publish_after_validation, true);
  assert.strictEqual(status.worktrees[0].publish.remote, 'origin');
  assert.strictEqual(status.worktrees[0].publish.branch, 'feature');
  assert.strictEqual(status.worktrees[0].publish.status, 'local-only');
}

function testWorkspaceStatusIncludesDirtyFileSummary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-workspace-dirty-summary-'));
  const repo = path.join(root, 'repo-a-feature');
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__feature:',
    '    repo: repo-a',
    '    path: repo-a-feature',
    '    branch: feature',
    'workspace_sets:',
    '  feature-a:',
    '    worktrees: ["repo_a__feature"]',
    'env_profiles:',
    '  local:',
    '    type: local',
    'defaults:',
    '  workspace_set: feature-a',
    '  env: local',
    '  sync: local',
  ].join('\n') + '\n');

  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  execFileSync('git', ['checkout', '-b', 'feature'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo, 'README.md'), '# repo\n');
  writeFile(path.join(repo, 'tracked.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });

  writeFile(path.join(repo, 'tracked.txt'), 'dirty\n');
  writeFile(path.join(repo, 'staged.txt'), 'staged\n');
  execFileSync('git', ['add', 'staged.txt'], { cwd: repo });
  writeFile(path.join(repo, 'untracked.txt'), 'untracked\n');

  const status = runCli(root, ['ws', 'status', '--root', root, '--set', 'feature-a']);
  const worktree = status.worktrees[0];
  assert.strictEqual(worktree.dirty, true);
  assert.strictEqual(worktree.dirty_file_count, 3);
  assert.deepStrictEqual(worktree.dirty_summary, {
    staged: 1,
    unstaged: 1,
    untracked: 1,
  });
  assert.deepStrictEqual(
    worktree.dirty_files.map(file => file.path).sort(),
    ['staged.txt', 'tracked.txt', 'untracked.txt']
  );

  const session = runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'feature-a',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
  ]);
  const sessionStatus = runCli(root, ['session', 'status', '--root', root, '--run', session.run_id]);
  assert.strictEqual(sessionStatus.worktrees[0].dirty_file_count, 3);
  assert.strictEqual(sessionStatus.worktrees[0].dirty_files[0].path, 'staged.txt');

  const text = runCliText(root, ['session', 'status', '--root', root, '--run', session.run_id, '--text']);
  assert.match(text, /files:3/);
  assert.match(text, /staged\.txt/);

  const wsText = runCliText(root, ['ws', 'status', '--root', root, '--set', 'feature-a', '--text']);
  assert.match(wsText, /repo_a__feature\s+repo-a\s+feature/);
  assert.match(wsText, /files:3/);
  assert.match(wsText, /staged:1 unstaged:1 untracked:1/);
  assert.match(wsText, /untracked\.txt/);

  const wsTextLimited = runCliText(root, [
    'ws', 'status',
    '--root', root,
    '--set', 'feature-a',
    '--text',
    '--limit', '2',
  ]);
  assert.match(wsTextLimited, /\+1 more dirty files/);
  assert.doesNotMatch(wsTextLimited, /untracked\.txt/);

  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-workspace-unstaged-first-'));
  const repo2 = path.join(root2, 'repo-b-feature');
  writeFile(path.join(root2, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root2}`,
    'worktrees:',
    '  repo_b__feature:',
    '    repo: repo-b',
    '    path: repo-b-feature',
    '    branch: feature',
    'workspace_sets:',
    '  feature-b:',
    '    worktrees: ["repo_b__feature"]',
    'env_profiles:',
    '  local:',
    '    type: local',
    'defaults:',
    '  workspace_set: feature-b',
    '  env: local',
  ].join('\n') + '\n');
  fs.mkdirSync(repo2, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo2, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo2 });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo2 });
  execFileSync('git', ['checkout', '-b', 'feature'], { cwd: repo2, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo2, 'benchmarks.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo2 });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo2, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo2, 'benchmarks.txt'), 'dirty\n');
  const unstagedFirst = runCli(root2, ['ws', 'status', '--root', root2, '--set', 'feature-b']);
  assert.strictEqual(unstagedFirst.worktrees[0].dirty_files[0].path, 'benchmarks.txt');
}

function testWorkspacePublishPlanSurfacesPushCommands() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-workspace-publish-plan-'));
  const repo = path.join(root, 'repo-a-feature');
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__feature:',
    '    repo: repo-a',
    '    path: repo-a-feature',
    '    branch: feature',
    '    base_ref: HEAD~1',
    '    publish:',
    '      after_validation: true',
    '      remote: origin',
    '      branch: feature',
    '      status: local-only',
    'workspace_sets:',
    '  feature-a:',
    '    worktrees: ["repo_a__feature"]',
    'env_profiles:',
    '  local:',
    '    type: local',
    'defaults:',
    '  workspace_set: feature-a',
    '  env: local',
  ].join('\n') + '\n');

  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/repo-a.git'], { cwd: repo });
  execFileSync('git', ['checkout', '-b', 'feature'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo, 'README.md'), '# repo\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'base'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo, 'feature.txt'), 'feature\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'feature'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });

  const plan = runCli(root, ['ws', 'publish-plan', '--root', root, '--set', 'feature-a']);
  assert.strictEqual(plan.action, 'publish_plan');
  assert.strictEqual(plan.totals.entries, 1);
  assert.strictEqual(plan.totals.ready, 1);
  assert.strictEqual(plan.entries[0].action, 'create_remote_branch');
  assert.strictEqual(plan.entries[0].target_branch, 'feature');
  assert.strictEqual(plan.entries[0].commits_ahead_base, 1);
  assert.match(plan.entries[0].command, /git -C /);
  assert.match(plan.entries[0].command, /push "origin" "HEAD:feature"/);
}

function testWorkspacePublishRequiresGateAndRecordsPush() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-workspace-publish-apply-'));
  const repo = path.join(root, 'repo-a-feature');
  const remote = path.join(root, 'repo-a-remote.git');
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__feature:',
    '    repo: repo-a',
    '    path: repo-a-feature',
    '    branch: feature',
    '    base_ref: HEAD~1',
    '    publish:',
    '      after_validation: true',
    '      remote: origin',
    '      branch: feature',
    '    sync:',
    '      profile: local',
    '      remote_path: /tmp/remote/repo-a-feature',
    'workspace_sets:',
    '  feature-a:',
    '    worktrees: ["repo_a__feature"]',
    'env_profiles:',
    '  local:',
    '    type: local',
    '    work_dir: /tmp/remote',
    'defaults:',
    '  workspace_set: feature-a',
    '  env: local',
    '  sync: local',
  ].join('\n') + '\n');

  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '--bare', remote], { stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: repo });
  execFileSync('git', ['checkout', '-b', 'feature'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo, 'README.md'), '# repo\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'base'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo, 'feature.txt'), 'feature\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'feature'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });

  const session = runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'feature-a',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
  ]);
  runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', session.run_id,
    '--kind', 'env-doctor',
    '--status', 'passed',
    '--summary', 'env doctor passed',
  ]);
  runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', session.run_id,
    '--kind', 'sync',
    '--status', 'passed',
    '--summary', 'sync passed',
  ]);
  runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', session.run_id,
    '--kind', 'test',
    '--status', 'passed',
    '--summary', 'tests passed',
  ]);

  const blocked = runCli(root, ['ws', 'publish', '--root', root, '--set', 'feature-a']);
  assert.strictEqual(blocked.dry_run, true);
  assert.strictEqual(blocked.status, 'blocked');
  assert.deepStrictEqual(blocked.results[0].blocked_by, ['run_required']);

  const dryRun = runCli(root, [
    'ws', 'publish',
    '--root', root,
    '--set', 'feature-a',
    '--run', session.run_id,
  ]);
  assert.strictEqual(dryRun.dry_run, true);
  assert.strictEqual(dryRun.status, 'planned');
  assert.strictEqual(dryRun.totals.planned, 1);
  assert.match(dryRun.results[0].command, /push "origin" "HEAD:feature"/);

  const pushed = runCli(root, [
    'ws', 'publish',
    '--root', root,
    '--set', 'feature-a',
    '--run', session.run_id,
    '--yes',
  ]);
  assert.strictEqual(pushed.dry_run, false);
  assert.strictEqual(pushed.status, 'applied');
  assert.strictEqual(pushed.totals.pushed, 1);
  assert.strictEqual(pushed.record.event.kind, 'publish');
  assert.strictEqual(pushed.record.event.status, 'passed');
  assert.strictEqual(
    execFileSync('git', ['-C', remote, 'rev-parse', '--verify', 'refs/heads/feature'], { encoding: 'utf8' }).trim(),
    execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  );

  const status = runCli(root, ['session', 'status', '--root', root, '--run', session.run_id]);
  assert.strictEqual(status.evidence.publish.status, 'passed');
  assert.strictEqual(status.phase.status, 'complete');
}

function testWorkspacePublishDetectsAlreadyPublishedRemoteAhead() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-workspace-publish-remote-ahead-'));
  const repo = path.join(root, 'repo-a-feature');
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__feature:',
    '    repo: repo-a',
    '    path: repo-a-feature',
    '    branch: feature',
    '    publish:',
    '      after_validation: true',
    '      remote: origin',
    '      branch: feature',
    'workspace_sets:',
    '  feature-a:',
    '    worktrees: ["repo_a__feature"]',
    'env_profiles:',
    '  local:',
    '    type: local',
    'defaults:',
    '  workspace_set: feature-a',
    '  env: local',
  ].join('\n') + '\n');

  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/repo-a.git'], { cwd: repo });
  execFileSync('git', ['checkout', '-b', 'feature'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo, 'README.md'), '# repo\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'local head'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  const remoteAhead = execFileSync('git', [
    'commit-tree',
    'HEAD^{tree}',
    '-p',
    'HEAD',
    '-m',
    'remote ahead',
  ], { cwd: repo, encoding: 'utf8' }).trim();
  execFileSync('git', ['update-ref', 'refs/remotes/origin/feature', remoteAhead], { cwd: repo });

  const plan = runCli(root, ['ws', 'publish-plan', '--root', root, '--set', 'feature-a']);
  assert.strictEqual(plan.entries[0].action, 'already_published_remote_ahead');
  assert.strictEqual(plan.entries[0].commits_ahead_remote, 0);
  assert.strictEqual(plan.entries[0].commits_behind_remote, 1);
  assert.strictEqual(plan.entries[0].command, null);
  assert.match(plan.entries[0].reason, /remote already contains local HEAD/);
  assert.strictEqual(plan.totals.already_published, 1);
  assert.match(plan.next_action, /no git push is needed/);
}

function testSessionStatusPublishNextActionForAlreadyPublishedBranch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-workspace-session-published-'));
  const repo = path.join(root, 'repo-a-feature');
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__feature:',
    '    repo: repo-a',
    '    path: repo-a-feature',
    '    branch: feature',
    '    publish:',
    '      after_validation: true',
    '      remote: origin',
    '      branch: feature',
    'workspace_sets:',
    '  feature-a:',
    '    worktrees: ["repo_a__feature"]',
    'env_profiles:',
    '  local:',
    '    type: local',
    'defaults:',
    '  workspace_set: feature-a',
    '  env: local',
    '  sync: local',
  ].join('\n') + '\n');

  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/repo-a.git'], { cwd: repo });
  execFileSync('git', ['checkout', '-b', 'feature'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo, 'README.md'), '# repo\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'published head'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['update-ref', 'refs/remotes/origin/feature', 'HEAD'], { cwd: repo });

  const session = runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'feature-a',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
  ]);
  for (const kind of ['env-doctor', 'sync', 'test']) {
    runCli(root, [
      'session', 'record',
      '--root', root,
      '--run', session.run_id,
      '--kind', kind,
      '--status', 'passed',
      '--summary', `${kind} passed`,
    ]);
  }

  const status = runCli(root, ['session', 'status', '--root', root, '--run', session.run_id]);
  assert.strictEqual(status.phase.name, 'publish-local-branches');
  assert.strictEqual(status.publish.totals.already_published, 1);
  assert.strictEqual(status.publish.totals.create, 0);
  assert.strictEqual(status.publish.totals.update, 0);
  assert.ok(status.next_actions.some(action => action.includes('already present on the remote')));
  assert.ok(status.next_actions.some(action => action.includes('ws publish --yes --run')));
  assert.strictEqual(status.next_actions.some(action => action.startsWith('node ') && action.includes(' ws publish ')), false);

  const plan = runCli(root, ['ws', 'publish-plan', '--root', root, '--set', 'feature-a', '--run', session.run_id]);
  assert.match(plan.next_action, /no git push is needed/);

  const dryRun = runCli(root, [
    'ws', 'publish',
    '--root', root,
    '--set', 'feature-a',
    '--run', session.run_id,
  ]);
  assert.strictEqual(dryRun.status, 'planned');
  assert.strictEqual(dryRun.totals.already_published, 1);
  assert.match(dryRun.next_action, /no git push is needed/);
}

function testSessionStartSuggestsPublishPlanWhenNeeded() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-workspace-session-publish-'));
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__feature:',
    '    repo: repo-a',
    '    path: repo-a-feature',
    '    branch: feature',
    '    publish:',
    '      after_validation: true',
    '      remote: origin',
    '      branch: feature',
    'workspace_sets:',
    '  feature-a:',
    '    worktrees: ["repo_a__feature"]',
    'env_profiles:',
    '  local:',
    '    type: local',
    'defaults:',
    '  workspace_set: feature-a',
    '  env: local',
    '  sync: local',
  ].join('\n') + '\n');
  initGitRepo(path.join(root, 'repo-a-feature'));

  const session = runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'feature-a',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
  ]);

  const readme = fs.readFileSync(session.readme_path, 'utf8');
  assert.match(readme, /ws publish-plan/);
  assert.match(readme, new RegExp(`ws publish-plan[^\\n]+--run "${session.run_id}"`));
}

function testSessionStatusSummarizesEvidenceAndPublishPlan() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-workspace-session-status-'));
  const repo = path.join(root, 'repo-a-feature');
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__feature:',
    '    repo: repo-a',
    '    path: repo-a-feature',
    '    branch: feature',
    '    publish:',
    '      after_validation: true',
    '      remote: origin',
    '      branch: feature',
    '      status: local-only',
    '    sync:',
    '      profile: local',
    '      remote_path: /tmp/remote/repo-a-feature',
    'workspace_sets:',
    '  feature-a:',
    '    worktrees: ["repo_a__feature"]',
    'env_profiles:',
    '  local:',
    '    type: local',
    '    work_dir: /tmp/remote',
    'defaults:',
    '  workspace_set: feature-a',
    '  env: local',
    '  sync: local',
  ].join('\n') + '\n');

  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/repo-a.git'], { cwd: repo });
  execFileSync('git', ['checkout', '-b', 'feature'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo, 'README.md'), '# repo\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });

  const session = runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'feature-a',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
  ]);

  runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', session.run_id,
    '--kind', 'env-doctor',
    '--status', 'passed',
    '--summary', 'env doctor passed',
  ]);
  runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', session.run_id,
    '--kind', 'sync',
    '--status', 'passed',
    '--summary', 'sync passed',
  ]);
  runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', session.run_id,
    '--kind', 'test',
    '--status', 'passed',
    '--summary', 'tests passed',
  ]);

  const status = runCli(root, ['session', 'status', '--root', root, '--run', session.run_id]);
  assert.strictEqual(status.action, 'session_status');
  assert.strictEqual(status.phase.name, 'publish-local-branches');
  assert.strictEqual(status.phase.status, 'ready');
  assert.strictEqual(status.evidence.sync.status, 'passed');
  assert.strictEqual(status.evidence.test.status, 'passed');
  assert.strictEqual(status.gates.remote_validation.status, 'ready');
  assert.strictEqual(status.gates.publish.status, 'ready');
  assert.strictEqual(status.publish.totals.ready, 1);
  assert.match(status.publish.entries[0].command, /push "origin" "HEAD:feature"/);
  assert.ok(status.next_actions.some(action => action.includes('ws publish')));

  const latestStatus = runCli(root, ['session', 'status', '--root', root]);
  assert.strictEqual(latestStatus.run_id, session.run_id);

  const topLevelStatusText = runCliText(root, ['status', '--root', root, '--run', session.run_id]);
  assert.match(topLevelStatusText, /Workspace:/);
  assert.match(topLevelStatusText, /Track: feature-a/);
  assert.match(topLevelStatusText, /Phase: publish-local-branches \(ready\)/);
  assert.match(topLevelStatusText, /Evidence:/);
  assert.match(topLevelStatusText, /Worktrees:/);
  assert.match(topLevelStatusText, /Publish: 1 ready, 0 blocked, 1 create, 0 update/);
  assert.match(topLevelStatusText, /Next actions:/);
  assert.doesNotThrow(() => JSON.parse(runCliText(root, ['status', '--root', root, '--run', session.run_id, '--json'])));

  const topLevelStatus = runCli(root, ['status', '--root', root, '--run', session.run_id, '--json']);
  assert.strictEqual(topLevelStatus.action, 'session_status');
  assert.strictEqual(topLevelStatus.phase.name, 'publish-local-branches');
}

function testSessionStatusMarksEvidenceStaleWhenWorktreeHeadChanges() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-workspace-stale-head-'));
  const repo = path.join(root, 'repo-a-feature');
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__feature:',
    '    repo: repo-a',
    '    path: repo-a-feature',
    '    branch: feature',
    '    publish:',
    '      after_validation: true',
    '      remote: origin',
    '      branch: feature',
    '    sync:',
    '      profile: local',
    '      remote_path: /tmp/remote/repo-a-feature',
    'workspace_sets:',
    '  feature-a:',
    '    worktrees: ["repo_a__feature"]',
    'env_profiles:',
    '  local:',
    '    type: local',
    '    work_dir: /tmp/remote',
    'defaults:',
    '  workspace_set: feature-a',
    '  env: local',
    '  sync: local',
  ].join('\n') + '\n');

  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/repo-a.git'], { cwd: repo });
  execFileSync('git', ['checkout', '-b', 'feature'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo, 'README.md'), '# repo\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'validated head'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });

  const session = runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'feature-a',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
  ]);
  runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', session.run_id,
    '--kind', 'sync',
    '--status', 'passed',
    '--summary', 'sync passed',
  ]);
  runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', session.run_id,
    '--kind', 'test',
    '--status', 'passed',
    '--summary', 'tests passed',
  ]);

  writeFile(path.join(repo, 'new-head.txt'), 'new head\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'new unvalidated head'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });

  const status = runCli(root, ['session', 'status', '--root', root, '--run', session.run_id]);
  assert.strictEqual(status.phase.name, 'remote-validation');
  assert.strictEqual(status.phase.status, 'needs_attention');
  assert.match(status.phase.reason, /worktree_head_changed/);
  assert.strictEqual(status.head_check.status, 'changed');
  assert.strictEqual(status.gates.remote_validation.status, 'blocked');
  assert.strictEqual(status.gates.remote_validation.required[0].head_status, 'stale');
  assert.ok(status.next_actions.some(action => action.includes('remote-loop start')));
  assert.ok(status.next_actions.some(action => action.includes('--text')));

  const publish = runCli(root, ['ws', 'publish', '--root', root, '--set', 'feature-a', '--run', session.run_id]);
  assert.strictEqual(publish.status, 'blocked');
  assert.ok(publish.results[0].blocked_by.includes('run_gate_not_ready'));
}

function testSessionListSummarizesRunHistoryAndFiltersByTrack() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-session-list-'));
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees: {}',
    'workspace_sets:',
    '  track-a:',
    '    worktrees: []',
    '  track-b:',
    '    worktrees: []',
    'env_profiles:',
    '  local:',
    '    type: local',
    'defaults:',
    '  workspace_set: track-a',
    '  env: local',
    '  sync: local',
  ].join('\n') + '\n');

  runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'track-a',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
    '--id', 'run-a',
  ]);
  runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', 'run-a',
    '--kind', 'env-doctor',
    '--status', 'passed',
    '--summary', 'env passed',
  ]);
  runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', 'run-a',
    '--kind', 'sync',
    '--status', 'passed',
    '--summary', 'sync passed',
  ]);
  runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', 'run-a',
    '--kind', 'test',
    '--status', 'passed',
    '--summary', 'test passed',
  ]);

  runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'track-b',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
    '--id', 'run-b',
  ]);

  const list = runCli(root, ['session', 'list', '--root', root, '--limit', '10']);
  assert.strictEqual(list.action, 'session_list');
  assert.strictEqual(list.totals.matched, 2);
  assert.strictEqual(list.runs.length, 2);
  assert.deepStrictEqual(list.runs.map(run => run.run_id).sort(), ['run-a', 'run-b']);
  const listedRunB = list.runs.find(run => run.run_id === 'run-b');
  const listedRunA = list.runs.find(run => run.run_id === 'run-a');
  assert.strictEqual(listedRunB.workspace_set, 'track-b');
  assert.deepStrictEqual(listedRunA.evidence.passed.slice(0, 3), ['env-doctor', 'sync', 'test']);
  assert.deepStrictEqual(listedRunA.evidence.missing, []);
  assert.strictEqual(listedRunA.phase.status, 'complete');

  const filtered = runCli(root, ['session', 'list', '--root', root, '--set', 'track-a']);
  assert.strictEqual(filtered.totals.matched, 1);
  assert.strictEqual(filtered.runs[0].run_id, 'run-a');

  const text = runCliText(root, ['session', 'list', '--root', root, '--set', 'track-a', '--text']);
  assert.match(text, /Recent runs:/);
  assert.match(text, /run-a\s+track-a\s+remote-validation-complete\/complete/);
  assert.match(text, /passed: env-doctor,sync,test/);
  assert.match(text, /missing: -/);

  writeFile(path.join(root, '.devteam', 'runs', 'broken', 'session.json'), '{ broken json');
  writeFile(path.join(root, '.devteam', 'runs', 'orphan', 'session.json'), JSON.stringify({
    version: 1,
    run_id: 'orphan',
    created_at: new Date().toISOString(),
    workspace: root,
    workspace_set: 'deleted-track',
    profiles: {
      sync: 'local',
      env: 'local',
      build: null,
      deploy: null,
    },
  }, null, 2) + '\n');
  const withBroken = runCli(root, ['session', 'list', '--root', root]);
  assert.strictEqual(withBroken.totals.unreadable, 2);
  assert.deepStrictEqual(withBroken.unreadable.map(item => item.run_id).sort(), ['broken', 'orphan']);

  const latest = runCli(root, ['status', '--root', root, '--json']);
  assert.strictEqual(latest.run_id, 'run-a');
  assert.strictEqual(latest.workspace_set, 'track-a');

  const latestForTrackB = runCli(root, ['status', '--root', root, '--set', 'track-b', '--json']);
  assert.strictEqual(latestForTrackB.run_id, 'run-b');
  assert.strictEqual(latestForTrackB.workspace_set, 'track-b');

  const latestForTrackA = runCli(root, ['status', '--root', root, '--set', 'track-a', '--json']);
  assert.strictEqual(latestForTrackA.run_id, 'run-a');
  assert.strictEqual(latestForTrackA.workspace_set, 'track-a');

  const sessionStatusForTrackA = runCli(root, ['session', 'status', '--root', root, '--set', 'track-a']);
  assert.strictEqual(sessionStatusForTrackA.run_id, 'run-a');

  const lint = runCli(root, ['session', 'lint', '--root', root]);
  assert.strictEqual(lint.action, 'session_lint');
  assert.strictEqual(lint.status, 'failed');
  assert.ok(['run-a', 'run-b'].includes(lint.latest_run_id));
  assert.ok(lint.issues.some(issue => issue.kind === 'malformed_session_json' && issue.run_id === 'broken'));
  assert.ok(lint.issues.some(issue => issue.kind === 'unknown_workspace_set' && issue.run_id === 'orphan'));

  const lintText = runCliText(root, ['session', 'lint', '--root', root, '--text']);
  assert.match(lintText, /Latest readable run: run-[ab]/);
  assert.match(lintText, /unknown_workspace_set/);

  const lintTrackA = runCli(root, ['session', 'lint', '--root', root, '--set', 'track-a']);
  assert.strictEqual(lintTrackA.latest_run_id, 'run-a');

  const archivePlan = runCli(root, ['session', 'archive-plan', '--root', root]);
  assert.strictEqual(archivePlan.action, 'session_archive_plan');
  assert.strictEqual(archivePlan.dry_run, true);
  assert.strictEqual(archivePlan.totals.candidates, 2);
  assert.deepStrictEqual(archivePlan.candidates.map(item => item.run_id).sort(), ['broken', 'orphan']);
  assert.ok(archivePlan.candidates.find(item => item.run_id === 'broken').reasons.includes('malformed_session_json'));
  assert.ok(archivePlan.candidates.find(item => item.run_id === 'orphan').reasons.includes('unknown_workspace_set'));

  const archiveDryRun = runCli(root, ['session', 'archive', '--root', root]);
  assert.strictEqual(archiveDryRun.action, 'session_archive');
  assert.strictEqual(archiveDryRun.dry_run, true);
  assert.strictEqual(fs.existsSync(path.join(root, '.devteam', 'runs', 'broken')), true);

  const archiveText = runCliText(root, ['session', 'archive-plan', '--root', root, '--text']);
  assert.match(archiveText, /Candidates: 2, archiveable: 2, blocked: 0/);
  assert.match(archiveText, /broken\s+archive\s+malformed_session_json/);

  const archived = runCli(root, ['session', 'archive', '--root', root, '--yes']);
  assert.strictEqual(archived.status, 'applied');
  assert.strictEqual(archived.totals.archived, 2);
  assert.strictEqual(fs.existsSync(path.join(root, '.devteam', 'runs', 'broken')), false);
  assert.strictEqual(fs.existsSync(path.join(root, '.devteam', 'runs-archive', 'broken', 'session.json')), true);
  assert.strictEqual(fs.existsSync(path.join(root, '.devteam', 'runs-archive', 'orphan', 'session.json')), true);

  const lintAfterArchive = runCli(root, ['session', 'lint', '--root', root]);
  assert.strictEqual(lintAfterArchive.status, 'passed');
  assert.strictEqual(lintAfterArchive.totals.issues, 0);
}

function testSessionLifecycleCanCloseStaleRunsOutOfActiveHistory() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-session-lifecycle-'));
  const repo = path.join(root, 'repo-a-feature');
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__feature:',
    '    repo: repo-a',
    '    path: repo-a-feature',
    '    branch: feature',
    '    sync:',
    '      profile: local',
    '      remote_path: /tmp/remote/repo-a-feature',
    'workspace_sets:',
    '  track-a:',
    '    worktrees: ["repo_a__feature"]',
    'env_profiles:',
    '  local:',
    '    type: local',
    'defaults:',
    '  workspace_set: track-a',
    '  env: local',
    '  sync: local',
  ].join('\n') + '\n');

  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  execFileSync('git', ['checkout', '-b', 'feature'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo, 'README.md'), '# repo\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'validated head'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });

  const oldRun = runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'track-a',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
    '--id', 'old-run',
  ]);
  runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', oldRun.run_id,
    '--kind', 'sync',
    '--status', 'passed',
    '--summary', 'sync passed',
  ]);
  runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', oldRun.run_id,
    '--kind', 'test',
    '--status', 'passed',
    '--summary', 'tests passed',
  ]);

  writeFile(path.join(repo, 'new-head.txt'), 'new head\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'new head'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });

  const staleLint = runCli(root, ['session', 'lint', '--root', root]);
  assert.strictEqual(staleLint.status, 'needs_attention');
  assert.strictEqual(staleLint.totals.warnings, 1);

  const newRun = runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'track-a',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
    '--id', 'new-run',
  ]);

  const supersedePlan = runCli(root, ['session', 'supersede-plan', '--root', root]);
  assert.strictEqual(supersedePlan.action, 'session_supersede_plan');
  assert.strictEqual(supersedePlan.totals.candidates, 1);
  assert.strictEqual(supersedePlan.totals.supersedeable, 1);
  assert.strictEqual(supersedePlan.candidates[0].run_id, oldRun.run_id);
  assert.strictEqual(supersedePlan.candidates[0].by_run, newRun.run_id);

  const superseded = runCli(root, [
    'session', 'supersede',
    '--root', root,
    '--run', oldRun.run_id,
    '--by', newRun.run_id,
    '--reason', 'new HEAD has a fresh validation run',
  ]);
  assert.strictEqual(superseded.lifecycle.status, 'superseded');
  assert.strictEqual(superseded.lifecycle.by_run, newRun.run_id);

  const sessionJson = JSON.parse(fs.readFileSync(path.join(root, '.devteam', 'runs', 'old-run', 'session.json'), 'utf8'));
  assert.strictEqual(sessionJson.lifecycle.status, 'superseded');

  const defaultList = runCli(root, ['session', 'list', '--root', root, '--limit', '10']);
  assert.deepStrictEqual(defaultList.runs.map(run => run.run_id), ['new-run']);
  assert.strictEqual(defaultList.totals.skipped_closed, 1);

  const allList = runCli(root, ['session', 'list', '--root', root, '--limit', '10', '--all']);
  assert.deepStrictEqual(allList.runs.map(run => run.run_id).sort(), ['new-run', 'old-run']);
  assert.strictEqual(allList.runs.find(run => run.run_id === 'old-run').lifecycle.status, 'superseded');

  const lint = runCli(root, ['session', 'lint', '--root', root]);
  assert.strictEqual(lint.status, 'passed');
  assert.strictEqual(lint.totals.skipped_closed, 1);
  assert.strictEqual(lint.totals.warnings, 0);

  const allLint = runCli(root, ['session', 'lint', '--root', root, '--all']);
  assert.strictEqual(allLint.status, 'needs_attention');
  assert.strictEqual(allLint.totals.warnings, 1);

  const latest = runCli(root, ['status', '--root', root, '--json']);
  assert.strictEqual(latest.run_id, 'new-run');

  const blockedRecord = runCliFailure(root, [
    'session', 'record',
    '--root', root,
    '--run', oldRun.run_id,
    '--kind', 'env-doctor',
    '--status', 'passed',
    '--summary', 'late env doctor',
  ]);
  assert.notStrictEqual(blockedRecord.status, 0);
  assert.match(blockedRecord.stderr, /Refusing to record evidence for superseded run/);

  const reopened = runCli(root, [
    'session', 'reopen',
    '--root', root,
    '--run', oldRun.run_id,
    '--reason', 'need to inspect older run again',
  ]);
  assert.strictEqual(reopened.lifecycle.status, 'open');

  const lintAfterReopen = runCli(root, ['session', 'lint', '--root', root]);
  assert.strictEqual(lintAfterReopen.status, 'needs_attention');
  assert.strictEqual(lintAfterReopen.totals.warnings, 1);
}

function testSessionSupersedeStaleOnlyClosesOlderRuns() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-session-supersede-stale-'));
  const repo = path.join(root, 'repo-a-feature');
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__feature:',
    '    repo: repo-a',
    '    path: repo-a-feature',
    '    branch: feature',
    '    sync:',
    '      profile: local',
    '      remote_path: /tmp/remote/repo-a-feature',
    'workspace_sets:',
    '  track-a:',
    '    worktrees: ["repo_a__feature"]',
    'env_profiles:',
    '  local:',
    '    type: local',
    'defaults:',
    '  workspace_set: track-a',
    '  env: local',
    '  sync: local',
  ].join('\n') + '\n');

  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  execFileSync('git', ['checkout', '-b', 'feature'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo, 'README.md'), '# repo\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'head one'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });

  for (const id of ['run-1', 'run-2']) {
    runCli(root, [
      'session', 'start',
      '--root', root,
      '--set', 'track-a',
      '--sync', 'local',
      '--env', 'local',
      '--no-build',
      '--no-deploy',
      '--id', id,
    ]);
    runCli(root, [
      'session', 'record',
      '--root', root,
      '--run', id,
      '--kind', 'sync',
      '--status', 'passed',
      '--summary', `${id} sync passed`,
    ]);
    runCli(root, [
      'session', 'record',
      '--root', root,
      '--run', id,
      '--kind', 'test',
      '--status', 'passed',
      '--summary', `${id} tests passed`,
    ]);
    writeFile(path.join(repo, `${id}.txt`), `${id}\n`);
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-m', `${id} next head`], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  }

  const plan = runCli(root, ['session', 'supersede-plan', '--root', root]);
  assert.strictEqual(plan.totals.candidates, 2);
  const run1 = plan.candidates.find(item => item.run_id === 'run-1');
  const run2 = plan.candidates.find(item => item.run_id === 'run-2');
  assert.strictEqual(run1.action, 'supersede');
  assert.strictEqual(run1.by_run, 'run-2');
  assert.strictEqual(run2.action, 'blocked');
  assert.ok(run2.blocked_by.includes('latest_open_run'));

  const applied = runCli(root, ['session', 'supersede-stale', '--root', root, '--yes']);
  assert.strictEqual(applied.status, 'applied');
  assert.strictEqual(applied.totals.superseded, 1);
  assert.strictEqual(applied.totals.skipped, 1);

  const lint = runCli(root, ['session', 'lint', '--root', root]);
  assert.strictEqual(lint.status, 'needs_attention');
  assert.strictEqual(lint.totals.skipped_closed, 1);
  assert.strictEqual(lint.totals.warnings, 1);
  assert.strictEqual(lint.issues[0].run_id, 'run-2');

  const allLint = runCli(root, ['session', 'lint', '--root', root, '--all']);
  assert.strictEqual(allLint.totals.warnings, 2);
}

function testTrackListStatusAndUseUpdatesDefaults() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-track-'));
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__old:',
    '    repo: repo-a',
    '    path: worktrees/old/repo-a',
    '    branch: old',
    '    sync:',
    '      profile: remote-test-old',
    '  repo_a__v0201:',
    '    repo: repo-a',
    '    path: worktrees/v0201/repo-a',
    '    branch: v0201',
    '    sync:',
    '      profile: remote-test-v0201',
    'workspace_sets:',
    '  old:',
    '    description: Old multi-repo track',
    '    worktrees: ["repo_a__old"]',
    '  v0201:',
    '    description: vLLM-only track',
    '    worktrees: ["repo_a__v0201"]',
    'env_profiles:',
    '  remote-test-old:',
    '    type: remote_dev',
    '    ssh: "ssh root@old"',
    '  remote-test-v0201:',
    '    type: remote_dev',
    '    ssh: "ssh root@v0201"',
    'build_profiles:',
    '  old-image:',
    '    workspace_set: old',
    '    env: image-build',
    'deploy_profiles:',
    '  preprod:',
    '    type: k8s',
    'deploy_flows:',
    '  old-preprod:',
    '    profile: preprod',
    'validation_profiles:',
    '  old-remote-venv:',
    '    workspace_set: old',
    '    env: remote-test-old',
    '  v0201-remote-venv:',
    '    workspace_set: v0201',
    '    env: remote-test-v0201',
    'defaults:',
    '  workspace_set: old',
    '  env: remote-test-old',
    '  sync: remote-test-old',
    '  build: old-image',
    '  deploy: preprod',
    '  deploy_flow: old-preprod',
    '  validation: old-remote-venv',
  ].join('\n') + '\n');

  const list = runCli(root, ['track', 'list', '--root', root]);
  assert.strictEqual(list.action, 'track_list');
  assert.strictEqual(list.active_track, 'old');
  assert.strictEqual(list.active_source, 'default');
  assert.strictEqual(list.default_track, 'old');
  assert.strictEqual(list.tracks.length, 2);
  assert.strictEqual(list.tracks.find(track => track.name === 'old').build, 'old-image');
  assert.strictEqual(list.tracks.find(track => track.name === 'v0201').build, null);
  assert.strictEqual(list.tracks.find(track => track.name === 'v0201').env, 'remote-test-v0201');
  assert.strictEqual(list.tracks.find(track => track.name === 'v0201').validation, 'v0201-remote-venv');
  assert.strictEqual(list.tracks.find(track => track.name === 'old').runtime.workspace.missing, 1);
  assert.strictEqual(list.tracks.find(track => track.name === 'old').runtime.latest_run, null);
  assert.strictEqual(list.tracks.find(track => track.name === 'old').runtime.next_actions[0].kind, 'materialize');
  assert.match(list.tracks.find(track => track.name === 'old').runtime.next_actions[0].command, /ws materialize/);

  const listText = runCliText(root, ['track', 'list', '--root', root, '--text']);
  assert.match(listText, /Selected track: old \(default\)/);
  assert.match(listText, /\* old\s+status:active\s+worktrees:0\/1 dirty:0\s+run:-\s+phase:no-run/);
  assert.match(listText, /v0201\s+status:active\s+worktrees:0\/1 dirty:0\s+run:-\s+phase:no-run/);
  assert.match(listText, /next: node .* ws materialize .* --set "old"/);

  const envList = runCliWithEnv(root, ['track', 'list', '--root', root], {
    DEVTEAM_TRACK: 'v0201',
  });
  assert.strictEqual(envList.active_track, 'v0201');
  assert.strictEqual(envList.active_source, 'env');
  assert.strictEqual(envList.default_track, 'old');
  assert.strictEqual(envList.tracks.find(track => track.name === 'v0201').active, true);
  assert.strictEqual(envList.tracks.find(track => track.name === 'old').active, false);

  const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-track-alias-'));
  writeFile(path.join(aliasRoot, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${aliasRoot}`,
    'worktrees:',
    '  repo_a__track_a:',
    '    repo: repo-a',
    '    path: worktrees/track-a/repo-a',
    '    branch: track-a',
    '    sync:',
    '      profile: remote-test-kimi-pd-pegaflow-v0201',
    '  repo_a__tokenspeed:',
    '    repo: repo-a',
    '    path: worktrees/tokenspeed/repo-a',
    '    branch: tokenspeed',
    '    sync:',
    '      profile: remote-test-kimi-pd-pegaflow-v0201-tokenspeed',
    'workspace_sets:',
    '  kimi-pd-pegaflow-v0201:',
    '    description: v0201 canonical track',
    '    aliases: [v0201, 0201]',
    '    worktrees: ["repo_a__track_a"]',
    '  kimi-pd-pegaflow-v0201-tokenspeed:',
    '    description: TokenSpeed canonical track',
    '    aliases: [tokenspeed, ts-mla]',
    '    worktrees: ["repo_a__tokenspeed"]',
    'env_profiles:',
    '  remote-test-kimi-pd-pegaflow-v0201:',
    '    type: remote_dev',
    '    ssh: "ssh root@v0201"',
    '  remote-test-kimi-pd-pegaflow-v0201-tokenspeed:',
    '    type: remote_dev',
    '    ssh: "ssh root@tokenspeed"',
    'defaults:',
    '  workspace_set: kimi-pd-pegaflow-v0201',
    '  env: remote-test-kimi-pd-pegaflow-v0201',
    '  sync: remote-test-kimi-pd-pegaflow-v0201',
  ].join('\n') + '\n');

  const aliasStatus = runCli(aliasRoot, ['track', 'status', '--root', aliasRoot, '--set', 'tokenspeed']);
  assert.strictEqual(aliasStatus.active_track, 'kimi-pd-pegaflow-v0201-tokenspeed');
  assert.deepStrictEqual(aliasStatus.track.aliases, ['tokenspeed', 'ts-mla']);
  assert.strictEqual(aliasStatus.track.env, 'remote-test-kimi-pd-pegaflow-v0201-tokenspeed');

  const aliasWs = runCli(aliasRoot, ['ws', 'status', '--root', aliasRoot, '--set', 'ts mla']);
  assert.strictEqual(aliasWs.workspace_set, 'kimi-pd-pegaflow-v0201-tokenspeed');
  assert.deepStrictEqual(aliasWs.worktrees.map(item => item.id), ['repo_a__tokenspeed']);

  const aliasEnv = runCliWithEnv(aliasRoot, ['track', 'status', '--root', aliasRoot], {
    DEVTEAM_TRACK: '0201',
  });
  assert.strictEqual(aliasEnv.active_track, 'kimi-pd-pegaflow-v0201');
  assert.strictEqual(aliasEnv.active_source, 'env');

  const aliasBind = runCli(aliasRoot, ['track', 'bind', 'tokenspeed', '--root', aliasRoot]);
  assert.strictEqual(aliasBind.track, 'kimi-pd-pegaflow-v0201-tokenspeed');
  assert.match(aliasBind.command, /kimi-pd-pegaflow-v0201-tokenspeed/);

  const aliasUse = runCli(aliasRoot, ['track', 'use', 'tokenspeed', '--root', aliasRoot, '--dry-run']);
  assert.strictEqual(aliasUse.next_defaults.workspace_set, 'kimi-pd-pegaflow-v0201-tokenspeed');

  const lifecycleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-track-life-'));
  writeFile(path.join(lifecycleRoot, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${lifecycleRoot}`,
    'worktrees: {}',
    'workspace_sets:',
    '  active-track:',
    '    status: active',
    '    worktrees: []',
    '  parked-track:',
    '    status: parked',
    '    worktrees: []',
    '  archived-track:',
    '    status: archived',
    '    worktrees: []',
    '  default-parked:',
    '    status: parked',
    '    worktrees: []',
    'env_profiles:',
    '  local:',
    '    type: local',
    'defaults:',
    '  workspace_set: default-parked',
    '  env: local',
    '  sync: local',
  ].join('\n') + '\n');
  const allLifecycle = runCli(lifecycleRoot, ['track', 'list', '--root', lifecycleRoot]);
  assert.deepStrictEqual(allLifecycle.tracks.map(track => track.name).sort(), [
    'active-track',
    'archived-track',
    'default-parked',
    'parked-track',
  ]);
  assert.strictEqual(allLifecycle.filter, 'all');
  const activeLifecycle = runCli(lifecycleRoot, ['track', 'list', '--root', lifecycleRoot, '--active-only']);
  assert.deepStrictEqual(activeLifecycle.tracks.map(track => track.name).sort(), [
    'active-track',
    'default-parked',
  ]);
  assert.strictEqual(activeLifecycle.filter, 'active');
  assert.strictEqual(activeLifecycle.totals.hidden, 2);
  const activeText = runCliText(lifecycleRoot, ['track', 'list', '--root', lifecycleRoot, '--active-only', '--text']);
  assert.match(activeText, /Filter: active \(2 hidden\)/);
  assert.doesNotMatch(activeText, /archived-track/);

  runCli(lifecycleRoot, [
    'session', 'start',
    '--root', lifecycleRoot,
    '--set', 'active-track',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
    '--id', 'run-open',
  ]);
  runCli(lifecycleRoot, [
    'session', 'start',
    '--root', lifecycleRoot,
    '--set', 'active-track',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
    '--id', 'run-closed',
  ]);
  runCli(lifecycleRoot, [
    'session', 'close',
    '--root', lifecycleRoot,
    '--run', 'run-closed',
    '--reason', 'done',
  ]);
  runCli(lifecycleRoot, [
    'session', 'start',
    '--root', lifecycleRoot,
    '--set', 'active-track',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
    '--id', 'run-superseded',
  ]);
  runCli(lifecycleRoot, [
    'session', 'supersede',
    '--root', lifecycleRoot,
    '--run', 'run-superseded',
    '--by', 'run-open',
  ]);
  const historyList = runCli(lifecycleRoot, ['track', 'list', '--root', lifecycleRoot, '--set', 'active-track']);
  const activeTrack = historyList.tracks.find(track => track.name === 'active-track');
  assert.strictEqual(activeTrack.runtime.run_history.totals.open, 1);
  assert.strictEqual(activeTrack.runtime.run_history.totals.closed, 1);
  assert.strictEqual(activeTrack.runtime.run_history.totals.superseded, 1);
  assert.strictEqual(activeTrack.runtime.run_history.latest_open_run_id, 'run-open');
  const historyText = runCliText(lifecycleRoot, ['track', 'list', '--root', lifecycleRoot, '--set', 'active-track', '--text']);
  assert.match(historyText, /active-track.*runs:open:1 closed:1 superseded:1/);
  const consoleScript = path.resolve(__dirname, '..', 'skills', 'devteam-console', 'scripts', 'devteam_console.py');
  const pickerOutput = execFileSync('python3', [
    consoleScript,
    '--root', lifecycleRoot,
    '--cli', CLI,
    '--tracks-only',
  ], {
    cwd: lifecycleRoot,
    encoding: 'utf8',
  });
  assert.match(pickerOutput, /latest=run-open phase=.* runs=open:1 closed:1 superseded:1/);

  const explicitStatus = runCliWithEnv(root, ['track', 'status', '--root', root, '--set', 'old'], {
    DEVTEAM_TRACK: 'v0201',
  });
  assert.strictEqual(explicitStatus.active_track, 'old');
  assert.strictEqual(explicitStatus.active_source, 'explicit');

  const bind = runCli(root, ['track', 'bind', 'v0201', '--root', root]);
  assert.strictEqual(bind.action, 'track_bind');
  assert.strictEqual(bind.track, 'v0201');
  assert.match(bind.command, /export DEVTEAM_TRACK="v0201"/);
  assert.strictEqual(bind.next_action.includes('does not modify'), true);

  const dryRun = runCli(root, ['track', 'use', 'v0201', '--root', root, '--dry-run']);
  assert.strictEqual(dryRun.dry_run, true);
  assert.strictEqual(dryRun.next_defaults.workspace_set, 'v0201');
  assert.strictEqual(dryRun.next_defaults.build, null);

  const used = runCli(root, ['track', 'use', 'v0201', '--root', root]);
  assert.strictEqual(used.action, 'track_use');
  assert.strictEqual(used.track, 'v0201');
  assert.strictEqual(used.next_defaults.env, 'remote-test-v0201');
  assert.strictEqual(used.next_defaults.sync, 'remote-test-v0201');
  assert.strictEqual(used.next_defaults.build, null);
  assert.strictEqual(used.next_defaults.deploy, null);
  assert.strictEqual(used.next_defaults.deploy_flow, null);
  assert.strictEqual(used.next_defaults.validation, 'v0201-remote-venv');

  const status = runCli(root, ['track', 'status', '--root', root]);
  assert.strictEqual(status.active_track, 'v0201');
  assert.strictEqual(status.active_source, 'default');
  assert.strictEqual(status.defaults.workspace_set, 'v0201');
  assert.strictEqual(status.defaults.env, 'remote-test-v0201');
  assert.strictEqual(status.defaults.build, null);
  assert.strictEqual(status.track.runtime.workspace.missing, 1);
  assert.strictEqual(status.track.runtime.next_actions[0].kind, 'materialize');

  const statusText = runCliText(root, ['track', 'status', '--root', root, '--text']);
  assert.match(statusText, /Selected track: v0201 \(default\)/);
  assert.match(statusText, /Workspace default: v0201/);
  assert.match(statusText, /Profiles: env=remote-test-v0201 sync=remote-test-v0201 build=-/);
  assert.match(statusText, /Latest run: -  phase=no-run/);
  assert.match(statusText, /Materialize missing local worktrees/);
  assert.match(statusText, /node .* ws materialize .* --set "v0201"/);

  const text = fs.readFileSync(path.join(root, '.devteam', 'config.yaml'), 'utf8');
  assert.match(text, /defaults:\n  workspace_set: "v0201"\n  env: "remote-test-v0201"\n  sync: "remote-test-v0201"\n  build: null\n  deploy: null\n  deploy_flow: null\n  validation: "v0201-remote-venv"/);
}

function testRemoteLoopStartDoctorSyncRecordAndStatus() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-remote-loop-'));
  const repo = path.join(root, 'repo-a-feature');
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__feature:',
    '    repo: repo-a',
    '    path: repo-a-feature',
    '    branch: feature',
    '    sync:',
    '      profile: remote-test-feature',
    '      remote_path: /tmp/remote/repo-a-feature',
    '      strategy: rsync-relative-patch-files',
    'workspace_sets:',
    '  feature-a:',
    '    worktrees: ["repo_a__feature"]',
    'env_profiles:',
    '  remote-test-feature:',
    '    type: remote_dev',
    '    ssh: "sh -c"',
    '    host: local-shell',
    `    source_dir: "${repo}"`,
    'defaults:',
    '  workspace_set: feature-a',
    '  env: remote-test-feature',
    '  sync: remote-test-feature',
  ].join('\n') + '\n');

  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  execFileSync('git', ['checkout', '-b', 'feature'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo, 'README.md'), '# repo\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });

  const plan = runCli(root, ['remote-loop', 'plan', '--root', root]);
  assert.strictEqual(plan.action, 'remote_loop_plan');
  assert.strictEqual(plan.track, 'feature-a');
  assert.strictEqual(plan.latest_run_state, 'none');
  assert.match(plan.commands.start, /remote-loop start/);
  const planText = runCliText(root, ['remote-loop', 'plan', '--root', root, '--text']);
  assert.match(planText, /Latest open run: - \(none\)/);
  assert.match(planText, /no open run exists yet; use start first/);
  assert.match(planText, /start: dt remote-loop start --set "feature-a"/);

  const start = runCli(root, [
    'remote-loop', 'start',
    '--root', root,
    '--id', 'loop-a',
  ]);
  assert.strictEqual(start.action, 'remote_loop_start');
  assert.strictEqual(start.workspace_set, 'feature-a');
  assert.strictEqual(start.profiles.env, 'remote-test-feature');
  assert.strictEqual(start.profiles.build, null);
  assert.ok(fs.existsSync(start.readme_path));

  const doctor = runCli(root, [
    'remote-loop', 'doctor',
    '--root', root,
    '--run', 'loop-a',
  ]);
  assert.strictEqual(doctor.status, 'pass');
  assert.strictEqual(doctor.record.event.kind, 'env-doctor');
  assert.strictEqual(doctor.record.event.status, 'passed');

  const sync = runCli(root, [
    'remote-loop', 'sync',
    '--root', root,
    '--run', 'loop-a',
  ]);
  assert.strictEqual(sync.action, 'remote_loop_sync_plan');
  assert.strictEqual(sync.execute, false);
  assert.strictEqual(sync.patch_mode, 'dirty-only');
  assert.strictEqual(sync.plan.totals.syncable, 0);

  writeFile(path.join(repo, 'dirty.txt'), 'dirty\n');
  const dirtySync = runCli(root, [
    'remote-loop', 'sync',
    '--root', root,
    '--run', 'loop-a',
  ]);
  assert.strictEqual(dirtySync.patch_mode, 'dirty-only');
  assert.strictEqual(dirtySync.plan.totals.syncable, 1);
  assert.deepStrictEqual(dirtySync.plan.entries[0].patch_files, ['dirty.txt']);

  const branchSync = runCli(root, [
    'remote-loop', 'sync',
    '--root', root,
    '--run', 'loop-a',
    '--branch-patch',
  ]);
  assert.strictEqual(branchSync.patch_mode, 'branch-patch');
  assert.strictEqual(branchSync.plan.totals.syncable, 1);
  assert.ok(branchSync.plan.entries[0].patch_files.includes('dirty.txt'));

  const logPath = path.join(root, 'pytest.log');
  writeFile(logPath, [
    'tests/example/test_remote_loop.py::test_loop PASSED [100%]',
    '======================= 1 passed in 0.12s =======================',
  ].join('\n') + '\n');
  const record = runCli(root, [
    'remote-loop', 'record-test',
    '--root', root,
    '--run', 'loop-a',
    '--pytest-log', logPath,
    '--command', 'python -m pytest tests/example/test_remote_loop.py',
  ]);
  assert.strictEqual(record.event.kind, 'test');
  assert.strictEqual(record.event.status, 'passed');

  const status = runCli(root, [
    'remote-loop', 'status',
    '--root', root,
    '--run', 'loop-a',
    '--json',
  ]);
  assert.strictEqual(status.action, 'session_status');
  assert.strictEqual(status.run_id, 'loop-a');
  assert.strictEqual(status.evidence['env-doctor'].status, 'passed');
  assert.strictEqual(status.evidence.test.status, 'passed');
  assert.strictEqual(status.evidence.sync.status, 'missing');

  const latestStatus = runCli(root, [
    'remote-loop', 'status',
    '--root', root,
    '--json',
  ]);
  assert.strictEqual(latestStatus.run_id, 'loop-a');

  const currentPlan = runCli(root, ['remote-loop', 'plan', '--root', root]);
  assert.strictEqual(currentPlan.latest_run.run_id, 'loop-a');
  assert.strictEqual(currentPlan.latest_run_state, 'open');
  assert.match(currentPlan.commands.doctor, /--run "loop-a"/);
  const currentPlanText = runCliText(root, ['remote-loop', 'plan', '--root', root, '--text']);
  assert.match(currentPlanText, /Latest open run: loop-a \(open\)/);
  assert.match(currentPlanText, /doctor: dt remote-loop doctor --set "feature-a" --run "loop-a"/);

  const startText = runCliText(root, [
    'remote-loop', 'start',
    '--root', root,
    '--id', 'loop-b',
    '--text',
  ]);
  assert.match(startText, /Remote Loop Started/);
  assert.match(startText, /Run: loop-b/);
  assert.match(startText, /doctor: dt remote-loop doctor --set "feature-a" --run "loop-b"/);
  assert.match(startText, /sync apply: dt remote-loop sync --set "feature-a" --run "loop-b" --yes/);
  assert.match(startText, /record test: dt remote-loop record-test --set "feature-a" --run "loop-b"/);
}

function testRemoteLoopIgnoresClosedRunsWhenResolvingLatest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-remote-loop-open-latest-'));
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees: {}',
    'workspace_sets:',
    '  feature-a:',
    '    worktrees: []',
    'env_profiles:',
    '  remote-test-feature:',
    '    type: local',
    'defaults:',
    '  workspace_set: feature-a',
    '  env: remote-test-feature',
    '  sync: remote-test-feature',
  ].join('\n') + '\n');

  runCli(root, [
    'remote-loop', 'start',
    '--root', root,
    '--id', 'loop-open',
  ]);
  runCli(root, [
    'remote-loop', 'start',
    '--root', root,
    '--id', 'loop-superseded',
  ]);
  runCli(root, [
    'session', 'supersede',
    '--root', root,
    '--run', 'loop-superseded',
    '--by', 'loop-open',
  ]);

  const plan = runCli(root, ['remote-loop', 'plan', '--root', root]);
  assert.strictEqual(plan.latest_run.run_id, 'loop-open');
  assert.strictEqual(plan.latest_run_state, 'open');
  assert.match(plan.commands.status, /remote-loop status/);

  const status = runCli(root, [
    'remote-loop', 'status',
    '--root', root,
    '--json',
  ]);
  assert.strictEqual(status.run_id, 'loop-open');
}

function testRemoteLoopPlanDoesNotReuseStaleRunForEvidenceWriters() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-remote-loop-stale-plan-'));
  const repo = path.join(root, 'repo-a-feature');
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__feature:',
    '    repo: repo-a',
    '    path: repo-a-feature',
    '    branch: feature',
    '    sync:',
    '      profile: remote-test-feature',
    '      remote_path: /tmp/remote/repo-a-feature',
    'workspace_sets:',
    '  feature-a:',
    '    worktrees: ["repo_a__feature"]',
    'env_profiles:',
    '  remote-test-feature:',
    '    type: local',
    'defaults:',
    '  workspace_set: feature-a',
    '  env: remote-test-feature',
    '  sync: remote-test-feature',
  ].join('\n') + '\n');

  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  execFileSync('git', ['checkout', '-b', 'feature'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo, 'README.md'), '# repo\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'validated head'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });

  runCli(root, [
    'remote-loop', 'start',
    '--root', root,
    '--id', 'loop-stale',
  ]);
  runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', 'loop-stale',
    '--kind', 'sync',
    '--status', 'passed',
    '--summary', 'sync passed',
  ]);
  runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', 'loop-stale',
    '--kind', 'test',
    '--status', 'passed',
    '--summary', 'tests passed',
  ]);

  writeFile(path.join(repo, 'new-head.txt'), 'new head\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'new head'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });

  const plan = runCli(root, ['remote-loop', 'plan', '--root', root]);
  assert.strictEqual(plan.latest_run.run_id, 'loop-stale');
  assert.strictEqual(plan.latest_run_state, 'stale');
  assert.match(plan.next_action, /Start a fresh run/);
  assert.match(plan.commands.doctor, /--run "<fresh-run-id>"/);
  assert.match(plan.commands.sync_apply, /--run "<fresh-run-id>"/);
  assert.match(plan.commands.record_test, /--run "<fresh-run-id>"/);
  assert.doesNotMatch(plan.commands.doctor, /--run "loop-stale"/);
  assert.doesNotMatch(plan.commands.sync_apply, /--run "loop-stale"/);
  assert.doesNotMatch(plan.commands.record_test, /--run "loop-stale"/);
  assert.match(plan.commands.status, /remote-loop status/);
  const planText = runCliText(root, ['remote-loop', 'plan', '--root', root, '--text']);
  assert.match(planText, /Latest open run: loop-stale \(stale\)/);
  assert.match(planText, /latest open run is stale; use start first/);
  assert.match(planText, /doctor: dt remote-loop doctor --set "feature-a" --run "<fresh-run-id>"/);
  assert.doesNotMatch(planText, /doctor: dt .* --run "loop-stale"/);

  const doctorBlocked = runCliFailure(root, [
    'remote-loop', 'doctor',
    '--root', root,
  ]);
  assert.strictEqual(doctorBlocked.status, 1);
  assert.match(doctorBlocked.stderr, /refused to use stale latest run 'loop-stale'/);

  const staleStatus = runCli(root, [
    'remote-loop', 'status',
    '--root', root,
    '--json',
  ]);
  assert.strictEqual(staleStatus.run_id, 'loop-stale');
  assert.strictEqual(staleStatus.head_check.status, 'changed');

  const syncPlan = runCli(root, [
    'remote-loop', 'sync',
    '--root', root,
  ]);
  assert.strictEqual(syncPlan.action, 'remote_loop_sync_plan');

  const syncApplyBlocked = runCliFailure(root, [
    'remote-loop', 'sync',
    '--root', root,
    '--yes',
  ]);
  assert.strictEqual(syncApplyBlocked.status, 1);
  assert.match(syncApplyBlocked.stderr, /refused to use stale latest run 'loop-stale'/);

  const logPath = path.join(root, 'pytest.log');
  writeFile(logPath, '======================= 1 passed in 0.12s =======================\n');
  const recordBlocked = runCliFailure(root, [
    'remote-loop', 'record-test',
    '--root', root,
    '--pytest-log', logPath,
    '--command', 'python -m pytest tests/example/test_remote_loop.py',
  ]);
  assert.strictEqual(recordBlocked.status, 1);
  assert.match(recordBlocked.stderr, /refused to use stale latest run 'loop-stale'/);
}

function testSessionLocalTrackEnvKeepsWorkspaceDefaultUntouched() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-session-track-'));
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__track_a:',
    '    repo: repo-a',
    '    path: track-a/repo-a',
    '    branch: track-a',
    '    sync:',
    '      profile: remote-test-track-a',
    '  repo_b__track_b:',
    '    repo: repo-b',
    '    path: track-b/repo-b',
    '    branch: track-b',
    '    sync:',
    '      profile: remote-test-track-b',
    'workspace_sets:',
    '  track-a:',
    '    worktrees: ["repo_a__track_a"]',
    '  track-b:',
    '    worktrees: ["repo_b__track_b"]',
    'env_profiles:',
    '  remote-test-track-a:',
    '    type: remote_dev',
    '    ssh: "ssh root@a"',
    '  remote-test-track-b:',
    '    type: remote_dev',
    '    ssh: "ssh root@b"',
    'validation_profiles:',
    '  track-a-remote-venv:',
    '    workspace_set: track-a',
    '    env: remote-test-track-a',
    '  track-b-remote-venv:',
    '    workspace_set: track-b',
    '    env: remote-test-track-b',
    'defaults:',
    '  workspace_set: track-a',
    '  env: remote-test-track-a',
    '  sync: remote-test-track-a',
    '  validation: track-a-remote-venv',
  ].join('\n') + '\n');

  const statusFromEnv = runCliWithEnv(root, ['track', 'status', '--root', root], {
    DEVTEAM_TRACK: 'track-b',
  });
  assert.strictEqual(statusFromEnv.active_track, 'track-b');
  assert.strictEqual(statusFromEnv.active_source, 'env');
  assert.strictEqual(statusFromEnv.default_track, 'track-a');
  assert.strictEqual(statusFromEnv.track.env, 'remote-test-track-b');

  const wsFromEnv = runCliWithEnv(root, ['ws', 'status', '--root', root], {
    DEVTEAM_TRACK: 'track-b',
  });
  assert.strictEqual(wsFromEnv.workspace_set, 'track-b');
  assert.strictEqual(wsFromEnv.workspace_set_source, 'env');
  assert.deepStrictEqual(wsFromEnv.worktrees.map(item => item.id), ['repo_b__track_b']);

  const startFromEnv = runCliWithEnv(root, [
    'remote-loop', 'start',
    '--root', root,
    '--id', 'track-b-run',
  ], {
    DEVTEAM_TRACK: 'track-b',
  });
  assert.strictEqual(startFromEnv.workspace_set, 'track-b');
  assert.strictEqual(startFromEnv.profiles.env, 'remote-test-track-b');
  assert.strictEqual(startFromEnv.profiles.sync, 'remote-test-track-b');

  const latestForEnv = runCliWithEnv(root, ['status', '--root', root, '--json'], {
    DEVTEAM_TRACK: 'track-b',
  });
  assert.strictEqual(latestForEnv.run_id, 'track-b-run');
  assert.strictEqual(latestForEnv.workspace_set, 'track-b');

  const defaultStatus = runCli(root, ['track', 'status', '--root', root]);
  assert.strictEqual(defaultStatus.active_track, 'track-a');
  assert.strictEqual(defaultStatus.active_source, 'default');
  assert.strictEqual(defaultStatus.defaults.workspace_set, 'track-a');

  const configText = fs.readFileSync(path.join(root, '.devteam', 'config.yaml'), 'utf8');
  assert.match(configText, /defaults:\n  workspace_set: track-a\n  env: remote-test-track-a/);

  const text = runCliTextWithEnv(root, ['track', 'status', '--root', root, '--text'], {
    DEVTEAM_TRACK: 'track-b',
  });
  assert.match(text, /Selected track: track-b \(env\)/);
  assert.match(text, /Workspace default: track-a/);
}

function testSessionRecordBlocksCrossTrackEvidence() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-record-guard-'));
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees: {}',
    'workspace_sets:',
    '  track-a:',
    '    aliases: [a]',
    '    worktrees: []',
    '  track-b:',
    '    aliases: [b]',
    '    worktrees: []',
    'env_profiles:',
    '  local:',
    '    type: local',
    'defaults:',
    '  workspace_set: track-a',
    '  env: local',
    '  sync: local',
  ].join('\n') + '\n');

  runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'track-a',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
    '--id', 'run-a',
  ]);

  const blocked = runCliFailure(root, [
    'session', 'record',
    '--root', root,
    '--run', 'run-a',
    '--set', 'track-b',
    '--kind', 'test',
    '--status', 'passed',
    '--summary', 'wrong track',
  ]);
  assert.notStrictEqual(blocked.status, 0);
  assert.match(blocked.stderr, /Refusing to record evidence/);
  assert.match(blocked.stderr, /run track 'track-a'/);
  assert.match(blocked.stderr, /current track is 'track-b'/);

  const allowed = runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', 'run-a',
    '--set', 'track-b',
    '--allow-cross-track',
    '--kind', 'test',
    '--status', 'passed',
    '--summary', 'intentional cross-track record',
  ]);
  assert.strictEqual(allowed.track_guard.status, 'allowed_cross_track');
  assert.strictEqual(allowed.track_guard.run_track, 'track-a');
  assert.strictEqual(allowed.track_guard.selected_track, 'track-b');

  const matched = runCliWithEnv(root, [
    'session', 'record',
    '--root', root,
    '--run', 'run-a',
    '--kind', 'sync',
    '--status', 'passed',
    '--summary', 'env selected track matched',
  ], {
    DEVTEAM_TRACK: 'a',
  });
  assert.strictEqual(matched.track_guard.status, 'matched');
  assert.strictEqual(matched.track_guard.selected_source, 'env');
}

function testSessionRecordBlocksStaleHeadEvidence() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-head-guard-'));
  const repo = path.join(root, 'repo-a-feature');
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__feature:',
    '    repo: repo-a',
    '    path: repo-a-feature',
    '    branch: feature',
    '    sync:',
    '      profile: local',
    'workspace_sets:',
    '  feature-a:',
    '    worktrees: ["repo_a__feature"]',
    'env_profiles:',
    '  local:',
    '    type: local',
    'defaults:',
    '  workspace_set: feature-a',
    '  env: local',
    '  sync: local',
  ].join('\n') + '\n');

  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  execFileSync('git', ['checkout', '-b', 'feature'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo, 'README.md'), '# repo\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });

  runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'feature-a',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
    '--id', 'head-run',
  ]);

  writeFile(path.join(repo, 'new-head.txt'), 'new head\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'new head'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });

  const envRecord = runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', 'head-run',
    '--set', 'feature-a',
    '--kind', 'env-doctor',
    '--status', 'passed',
    '--summary', 'env evidence is not head guarded',
  ]);
  assert.strictEqual(envRecord.head_guard.status, 'not_required');

  const blocked = runCliFailure(root, [
    'session', 'record',
    '--root', root,
    '--run', 'head-run',
    '--set', 'feature-a',
    '--kind', 'test',
    '--status', 'passed',
    '--summary', 'stale test evidence',
  ]);
  assert.notStrictEqual(blocked.status, 0);
  assert.match(blocked.stderr, /Refusing to record test evidence/);
  assert.match(blocked.stderr, /older worktree HEAD/);

  const allowed = runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', 'head-run',
    '--set', 'feature-a',
    '--allow-stale-head',
    '--kind', 'test',
    '--status', 'passed',
    '--summary', 'intentional stale-head test evidence',
  ]);
  assert.strictEqual(allowed.head_guard.status, 'allowed_stale_head');
  assert.strictEqual(allowed.head_guard.changes.length, 1);
  assert.strictEqual(allowed.head_guard.changes[0].id, 'repo_a__feature');
}

function testPresenceTouchListClearAndTrackRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-presence-'));
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees: {}',
    'workspace_sets:',
    '  track-a:',
    '    aliases: [a]',
    '    worktrees: []',
    '  track-b:',
    '    aliases: [b]',
    '    worktrees: []',
    'env_profiles:',
    '  local:',
    '    type: local',
    'defaults:',
    '  workspace_set: track-a',
    '  env: local',
    '  sync: local',
  ].join('\n') + '\n');

  const touched = runCli(root, [
    'presence', 'touch',
    '--root', root,
    '--set', 'a',
    '--session-id', 'codex-a',
    '--purpose', 'testing presence',
    '--run', 'run-a',
  ]);
  assert.strictEqual(touched.action, 'presence_touch');
  assert.strictEqual(touched.track, 'track-a');
  assert.strictEqual(touched.session_id, 'codex-a');
  assert.strictEqual(fs.existsSync(path.join(root, '.devteam', 'presence', 'codex-a.json')), true);

  const list = runCli(root, ['presence', 'list', '--root', root]);
  assert.strictEqual(list.totals.active, 1);
  assert.strictEqual(list.by_track['track-a'][0].session_id, 'codex-a');
  assert.strictEqual(list.by_track['track-a'][0].purpose, 'testing presence');

  const trackList = runCli(root, ['track', 'list', '--root', root]);
  const trackA = trackList.tracks.find(track => track.name === 'track-a');
  assert.strictEqual(trackA.runtime.presence_count, 1);
  assert.strictEqual(trackA.runtime.presence[0].session_id, 'codex-a');

  const text = runCliText(root, ['presence', 'list', '--root', root, '--text']);
  assert.match(text, /codex-a/);
  assert.match(text, /purpose=testing presence/);

  const clearPlan = runCli(root, ['presence', 'clear', '--root', root, '--session-id', 'codex-a']);
  assert.strictEqual(clearPlan.dry_run, true);
  assert.deepStrictEqual(clearPlan.candidates, ['codex-a']);
  assert.strictEqual(fs.existsSync(path.join(root, '.devteam', 'presence', 'codex-a.json')), true);

  const cleared = runCli(root, ['presence', 'clear', '--root', root, '--session-id', 'codex-a', '--yes']);
  assert.strictEqual(cleared.removed, 1);
  assert.strictEqual(fs.existsSync(path.join(root, '.devteam', 'presence', 'codex-a.json')), false);

  const inferredA = runCliWithEnv(root, [
    'presence', 'touch',
    '--root', root,
    '--set', 'track-b',
    '--purpose', 'stable codex session',
  ], {
    DEVTEAM_SESSION_ID: '',
    CODEX_THREAD_ID: 'thread-001',
  });
  assert.strictEqual(inferredA.session_id, 'codex-thread-001');
  assert.strictEqual(inferredA.presence.session_source, 'codex');

  const inferredB = runCliWithEnv(root, [
    'presence', 'touch',
    '--root', root,
    '--set', 'track-b',
  ], {
    DEVTEAM_SESSION_ID: '',
    CODEX_THREAD_ID: 'thread-001',
  });
  assert.strictEqual(inferredB.session_id, inferredA.session_id);

  const stableList = runCli(root, ['presence', 'list', '--root', root, '--set', 'track-b']);
  assert.strictEqual(stableList.totals.active, 1);
  assert.strictEqual(stableList.entries[0].session_id, 'codex-thread-001');
  assert.strictEqual(stableList.entries[0].purpose, 'stable codex session');
}

function testConsoleTouchesStablePresenceAndShowsSessionCount() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-console-presence-'));
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees: {}',
    'workspace_sets:',
    '  track-a:',
    '    worktrees: []',
    'env_profiles:',
    '  local:',
    '    type: local',
    'build_profiles:',
    '  track-a-tag-patch:',
    '    workspace_set: track-a',
    '    mode: tag_patch',
    '    image: registry.example.com/library/track-a:test',
    'defaults:',
    '  workspace_set: track-a',
    '  env: local',
    '  sync: local',
    '  build: track-a-tag-patch',
  ].join('\n') + '\n');
  const session = runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'track-a',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
  ]);
  const status = runCli(root, ['status', '--root', root, '--run', session.run_id, '--json']);
  assert.strictEqual(status.profiles.env, 'local');
  assert.strictEqual(status.profiles.sync, 'local');

  const script = path.resolve(__dirname, '..', 'skills', 'devteam-console', 'scripts', 'devteam_console.py');
  const output = execFileSync('python3', [
    script,
    '--root', root,
    '--cli', CLI,
    '--set', 'track-a',
    '--run', session.run_id,
    '--purpose', 'console test',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEVTEAM_SESSION_ID: '',
      CODEX_THREAD_ID: 'console-thread-001',
    },
  });
  assert.match(output, /Presence: codex-console-thread-001 touched/);
  assert.match(output, /Active sessions on track: 1/);
  assert.match(output, /Evidence: missing=env-doctor,sync,test/);
  assert.doesNotMatch(output, /missing=.*env-refresh/);
  assert.doesNotMatch(output, /missing=.*image-build/);
  assert.doesNotMatch(output, /missing=.*deploy/);
  assert.match(output, new RegExp(`Primary Next\\n- dt env doctor --profile "local" --remote --run "${session.run_id}"`));
  assert.match(output, /Daily Shortcuts/);
  assert.match(output, /remote-loop plan --set track-a --text/);
  assert.match(output, /remote-loop start --set track-a --text/);
  assert.match(output, new RegExp(`session status --run ${session.run_id} --text`));
  assert.match(output, new RegExp(`env doctor --profile local --remote --run ${session.run_id}`));
  assert.match(output, new RegExp(`image plan --set track-a --profile track-a-tag-patch --run ${session.run_id}`));
  assert.match(output, /Full command panels: reopen this console with --full/);
  assert.doesNotMatch(output, /Control Panels/);
  assert.doesNotMatch(output, new RegExp(`sync apply --set track-a --profile local --dirty-only --run ${session.run_id} --yes`));
  assert.doesNotMatch(output, /--run <run-id>/);
  assert.doesNotMatch(output, /--profile <env-profile>/);
  assert.doesNotMatch(output, /--profile <build-profile>/);

  const fullOutput = execFileSync('python3', [
    script,
    '--root', root,
    '--cli', CLI,
    '--set', 'track-a',
    '--run', session.run_id,
    '--no-presence',
    '--full',
  ], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.match(fullOutput, /Control Panels/);
  assert.match(fullOutput, new RegExp(`sync apply --set track-a --profile local --dirty-only --run ${session.run_id} --yes`));
  assert.match(fullOutput, /- Image \(track optional\):/);
  assert.doesNotMatch(fullOutput, /- Image:\n/);

  const list = runCli(root, ['presence', 'list', '--root', root, '--set', 'track-a']);
  assert.strictEqual(list.totals.active, 1);
  assert.strictEqual(list.entries[0].session_id, 'codex-console-thread-001');
  assert.strictEqual(list.entries[0].purpose, 'console test');
}

function testConsoleHidesMutatingRunCommandsForStaleRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-console-stale-'));
  const repo = path.join(root, 'repo-a-feature');
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__feature:',
    '    repo: repo-a',
    '    path: repo-a-feature',
    '    branch: feature',
    '    publish:',
    '      after_validation: true',
    '      remote: origin',
    '      branch: feature',
    '    sync:',
    '      profile: local',
    '      remote_path: /tmp/remote/repo-a-feature',
    'workspace_sets:',
    '  track-a:',
    '    worktrees: ["repo_a__feature"]',
    'env_profiles:',
    '  local:',
    '    type: local',
    '    work_dir: /tmp/remote',
    'build_profiles:',
    '  track-a-tag-patch:',
    '    workspace_set: track-a',
    '    mode: tag_patch',
    '    image: registry.example.com/library/track-a:test',
    'defaults:',
    '  workspace_set: track-a',
    '  env: local',
    '  sync: local',
    '  build: track-a-tag-patch',
  ].join('\n') + '\n');

  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/repo-a.git'], { cwd: repo });
  execFileSync('git', ['checkout', '-b', 'feature'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo, 'README.md'), '# repo\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'validated head'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });

  const session = runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'track-a',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
  ]);
  runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', session.run_id,
    '--kind', 'sync',
    '--status', 'passed',
    '--summary', 'sync passed',
  ]);
  runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', session.run_id,
    '--kind', 'test',
    '--status', 'passed',
    '--summary', 'tests passed',
  ]);

  writeFile(path.join(repo, 'new-head.txt'), 'new head\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'new unvalidated head'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });

  const script = path.resolve(__dirname, '..', 'skills', 'devteam-console', 'scripts', 'devteam_console.py');
  const output = execFileSync('python3', [
    script,
    '--root', root,
    '--cli', CLI,
    '--set', 'track-a',
    '--run', session.run_id,
    '--no-presence',
  ], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.match(output, /Primary Next\n- dt remote-loop start --set "track-a" --text/);
  assert.match(output, /Daily Shortcuts/);
  assert.match(output, /current run is stale; start a fresh run before recording evidence/);
  assert.match(output, /env doctor --profile local --remote/);
  assert.doesNotMatch(output, /Control Panels/);
  assert.doesNotMatch(output, /publish is blocked for this run/);
  assert.doesNotMatch(output, /current run is stale; start a fresh run before recording test evidence/);
  assert.doesNotMatch(output, new RegExp(`ws publish --set track-a --run ${session.run_id} --yes`));
  assert.doesNotMatch(output, new RegExp(`session record --run ${session.run_id}`));
  assert.doesNotMatch(output, new RegExp(`env doctor --profile local --remote --run ${session.run_id}`));
  assert.doesNotMatch(output, new RegExp(`env refresh --profile local --run ${session.run_id}`));
  assert.doesNotMatch(output, new RegExp(`sync apply --set track-a --profile local --dirty-only --run ${session.run_id} --yes`));
  assert.doesNotMatch(output, new RegExp(`image prepare --set track-a --profile track-a-tag-patch --run ${session.run_id}`));
  assert.doesNotMatch(output, new RegExp(`image record --run ${session.run_id}`));

  const fullOutput = execFileSync('python3', [
    script,
    '--root', root,
    '--cli', CLI,
    '--set', 'track-a',
    '--run', session.run_id,
    '--no-presence',
    '--full',
  ], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.match(fullOutput, /Control Panels/);
  assert.match(fullOutput, /Primary Next\n- dt remote-loop start --set "track-a" --text/);
  assert.match(fullOutput, /publish is blocked for this run/);
  assert.match(fullOutput, /current run is stale; start a fresh run before recording test evidence/);
  assert.match(fullOutput, /current run is stale; start a fresh run before recording env evidence/);
  assert.match(fullOutput, /current run is stale; start a fresh run before sync apply --run/);
  assert.match(fullOutput, /current run is stale; start a fresh run before preparing image context/);
  assert.match(fullOutput, /current run is stale; start a fresh run before recording image-build evidence/);
  assert.doesNotMatch(fullOutput, new RegExp(`ws publish --set track-a --run ${session.run_id} --yes`));
  assert.doesNotMatch(fullOutput, new RegExp(`session record --run ${session.run_id}`));
  assert.doesNotMatch(fullOutput, new RegExp(`env doctor --profile local --remote --run ${session.run_id}`));
  assert.doesNotMatch(fullOutput, new RegExp(`env refresh --profile local --run ${session.run_id}`));
  assert.doesNotMatch(fullOutput, new RegExp(`sync apply --set track-a --profile local --dirty-only --run ${session.run_id} --yes`));
  assert.doesNotMatch(fullOutput, new RegExp(`image prepare --set track-a --profile track-a-tag-patch --run ${session.run_id}`));
  assert.doesNotMatch(fullOutput, new RegExp(`image record --run ${session.run_id}`));
}

function testStatusSkillDisplaysDtShortcuts() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-status-skill-dt-'));
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__feature:',
    '    repo: repo-a',
    '    path: repo-a-feature',
    '    branch: feature',
    'workspace_sets:',
    '  track-a:',
    '    worktrees: ["repo_a__feature"]',
    'env_profiles:',
    '  local:',
    '    type: local',
    'defaults:',
    '  workspace_set: track-a',
    '  env: local',
    '  sync: local',
  ].join('\n') + '\n');

  const script = path.resolve(__dirname, '..', 'skills', 'devteam-status', 'scripts', 'devteam_status_summary.py');
  const output = execFileSync('python3', [
    script,
    '--root', root,
    '--cli', CLI,
    '--set', 'track-a',
    '--no-run',
  ], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.match(output, /Primary Next\n- dt ws materialize --set "track-a"/);
  assert.doesNotMatch(output, /Primary Next\n- node /);
  assert.doesNotMatch(output, new RegExp(`--root ${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
}

function testStatusSkillScopesHistoryToSelectedTrack() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-status-skill-scoped-history-'));
  const repoA = path.join(root, 'repo-a');
  const repoB = path.join(root, 'repo-b');
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a:',
    '    repo: repo-a',
    '    path: repo-a',
    '    branch: feature-a',
    '    sync:',
    '      profile: local',
    '      remote_path: /tmp/remote/repo-a',
    '  repo_b:',
    '    repo: repo-b',
    '    path: repo-b',
    '    branch: feature-b',
    '    sync:',
    '      profile: local',
    '      remote_path: /tmp/remote/repo-b',
    'workspace_sets:',
    '  track-a:',
    '    worktrees: ["repo_a"]',
    '  track-b:',
    '    worktrees: ["repo_b"]',
    'env_profiles:',
    '  local:',
    '    type: local',
    'defaults:',
    '  workspace_set: track-a',
    '  env: local',
    '  sync: local',
  ].join('\n') + '\n');

  for (const [repo, branch, fileName] of [
    [repoA, 'feature-a', 'a.txt'],
    [repoB, 'feature-b', 'b.txt'],
  ]) {
    fs.mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
    execFileSync('git', ['checkout', '-b', branch], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
    writeFile(path.join(repo, fileName), 'one\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-m', 'head one'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  }

  for (const [track, runId, repo, fileName] of [
    ['track-a', 'run-a', repoA, 'a2.txt'],
    ['track-b', 'run-b', repoB, 'b2.txt'],
  ]) {
    runCli(root, [
      'session', 'start',
      '--root', root,
      '--set', track,
      '--sync', 'local',
      '--env', 'local',
      '--no-build',
      '--no-deploy',
      '--id', runId,
    ]);
    runCli(root, [
      'session', 'record',
      '--root', root,
      '--run', runId,
      '--kind', 'sync',
      '--status', 'passed',
      '--summary', `${runId} sync passed`,
    ]);
    runCli(root, [
      'session', 'record',
      '--root', root,
      '--run', runId,
      '--kind', 'test',
      '--status', 'passed',
      '--summary', `${runId} tests passed`,
    ]);
    writeFile(path.join(repo, fileName), 'two\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-m', `${runId} next head`], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  }

  const script = path.resolve(__dirname, '..', 'skills', 'devteam-status', 'scripts', 'devteam_status_summary.py');
  const output = execFileSync('python3', [
    script,
    '--root', root,
    '--cli', CLI,
    '--set', 'track-a',
  ], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.match(output, /Track: track-a/);
  assert.match(output, /History: needs attention, 1 stale-evidence warning\(s\)/);
  assert.match(output, /run-a/);
  assert.doesNotMatch(output, /run-b/);
}

function testRemoteLoopRecordTestBlocksCrossTrackRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-remote-guard-'));
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees: {}',
    'workspace_sets:',
    '  track-a:',
    '    worktrees: []',
    '  track-b:',
    '    worktrees: []',
    'env_profiles:',
    '  remote-test-track-a:',
    '    type: local',
    '  remote-test-track-b:',
    '    type: local',
    'defaults:',
    '  workspace_set: track-a',
    '  env: remote-test-track-a',
    '  sync: remote-test-track-a',
  ].join('\n') + '\n');

  runCli(root, [
    'remote-loop', 'start',
    '--root', root,
    '--set', 'track-a',
    '--id', 'track-a-run',
  ]);
  const logPath = path.join(root, 'pytest.log');
  writeFile(logPath, '======================= 1 passed in 0.12s =======================\n');

  const blocked = runCliFailure(root, [
    'remote-loop', 'record-test',
    '--root', root,
    '--set', 'track-b',
    '--run', 'track-a-run',
    '--pytest-log', logPath,
  ]);
  assert.match(blocked.stderr, /Refusing to record evidence/);

  const allowed = runCli(root, [
    'remote-loop', 'record-test',
    '--root', root,
    '--set', 'track-b',
    '--run', 'track-a-run',
    '--pytest-log', logPath,
    '--allow-cross-track',
  ]);
  assert.strictEqual(allowed.track_guard.status, 'allowed_cross_track');
  assert.strictEqual(allowed.event.kind, 'test');
}

function testMaterializePlansLocalCloneFromSourcePath() {
  const newRoot = createStandardWorkspace();

  const plan = runCli(newRoot, ['ws', 'materialize', '--root', newRoot, '--set', 'feat-a']);
  assert.strictEqual(plan.applied, false);
  assert.strictEqual(plan.totals.clone, 1);
  assert.match(plan.entries[0].command, /git clone --no-hardlinks/);
  assert.match(plan.entries[0].command, /repo-a-dev/);
}

function testSyncPlanBecomesSyncableWhenWorktreeExists() {
  const newRoot = createStandardWorkspace();
  initGitRepo(path.join(newRoot, 'repo-a-dev'));

  const plan = runCli(newRoot, ['sync', 'plan', '--root', newRoot, '--set', 'feat-a', '--profile', 'build-server']);
  assert.strictEqual(plan.totals.entries, 1);
  assert.strictEqual(plan.totals.syncable, 1);
  assert.match(plan.entries[0].command, /rsync -az --delete/);
  assert.match(plan.entries[0].command, /builder@example\.com:\/remote\/build\/repo-a-dev\//);
}

function testSyncApplyDefaultsToDryRunPlan() {
  const newRoot = createStandardWorkspace();
  initGitRepo(path.join(newRoot, 'repo-a-dev'));

  const result = runCli(newRoot, ['sync', 'apply', '--root', newRoot, '--set', 'feat-a', '--profile', 'build-server']);
  assert.strictEqual(result.dry_run, true);
  assert.strictEqual(result.status, 'planned');
  assert.strictEqual(result.totals.planned, 1);
  assert.strictEqual(fs.existsSync(path.join(newRoot, '.devteam', 'state', 'sync-build-server.json')), false);
}

function testSyncPlanCanIncludeWorkspaceAssets() {
  const newRoot = createStandardWorkspace();
  initGitRepo(path.join(newRoot, 'repo-a-dev'));

  const plan = runCli(newRoot, [
    'sync', 'plan',
    '--root', newRoot,
    '--set', 'feat-a',
    '--profile', 'build-server',
    '--include-assets',
  ]);
  assert.ok(plan.entries.some(entry => entry.id === 'asset__build.sh'));
  assert.ok(plan.entries.some(entry => entry.id === 'asset__scripts'));
  assert.ok(plan.entries.some(entry => entry.id === 'asset__Dockerfile.dev'));
}

function testSyncPatchModesSeparateBranchPatchFromDirtyOnly() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-sync-patch-mode-'));
  const repo = path.join(root, 'repo-a-feature');
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  repo_a__feature:',
    '    repo: repo-a',
    '    path: repo-a-feature',
    '    branch: feature',
    '    base_ref: HEAD~1',
    '    sync:',
    '      profile: remote-test-feature',
    '      remote_path: /tmp/remote/repo-a-feature',
    '      strategy: rsync-relative-patch-files',
    'workspace_sets:',
    '  feature-a:',
    '    worktrees: ["repo_a__feature"]',
    'env_profiles:',
    '  remote-test-feature:',
    '    type: remote_dev',
    '    ssh: "sh -c"',
    '    host: local-shell',
    'defaults:',
    '  workspace_set: feature-a',
    '  env: remote-test-feature',
    '  sync: remote-test-feature',
  ].join('\n') + '\n');

  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  execFileSync('git', ['checkout', '-b', 'feature'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo, 'README.md'), '# repo\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'base'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(repo, 'feature.txt'), 'feature\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'feature'], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });

  const branchPatch = runCli(root, [
    'sync', 'plan',
    '--root', root,
    '--set', 'feature-a',
    '--profile', 'remote-test-feature',
  ]);
  assert.strictEqual(branchPatch.entries[0].patch_mode, 'branch-patch');
  assert.strictEqual(branchPatch.entries[0].action, 'sync');
  assert.deepStrictEqual(branchPatch.entries[0].patch_files, ['feature.txt']);

  const cleanDirtyOnly = runCli(root, [
    'sync', 'plan',
    '--root', root,
    '--set', 'feature-a',
    '--profile', 'remote-test-feature',
    '--dirty-only',
  ]);
  assert.strictEqual(cleanDirtyOnly.entries[0].patch_mode, 'dirty-only');
  assert.strictEqual(cleanDirtyOnly.entries[0].action, 'noop');
  assert.strictEqual(cleanDirtyOnly.entries[0].patch_file_count, 0);

  writeFile(path.join(repo, 'dirty.txt'), 'dirty\n');
  const dirtyOnly = runCli(root, [
    'sync', 'plan',
    '--root', root,
    '--set', 'feature-a',
    '--profile', 'remote-test-feature',
    '--dirty-only',
  ]);
  assert.strictEqual(dirtyOnly.entries[0].patch_mode, 'dirty-only');
  assert.strictEqual(dirtyOnly.entries[0].action, 'sync');
  assert.deepStrictEqual(dirtyOnly.entries[0].patch_files, ['dirty.txt']);
}

function testDoctorAggregatesWorkspaceChecks() {
  const newRoot = createStandardWorkspace();

  const doctor = runCli(newRoot, ['doctor', '--root', newRoot, '--set', 'feat-a']);
  assert.strictEqual(doctor.workspace, newRoot);
  assert.ok(['pass', 'needs_attention'].includes(doctor.status));
  assert.strictEqual(doctor.workspace_status.worktrees, 1);
  assert.strictEqual(doctor.history.totals.errors, 0);

  writeFile(path.join(newRoot, '.devteam', 'runs', 'broken', 'session.json'), '{ broken json');
  const doctorWithHistory = runCli(newRoot, ['doctor', '--root', newRoot]);
  assert.strictEqual(doctorWithHistory.history.totals.errors, 1);
  assert.ok(doctorWithHistory.problems.some(problem => /run-history/.test(problem)));
  assert.match(doctorWithHistory.next_action, /session archive-plan/);
}

function testImageAndDeployPlansUseConfiguredProfiles() {
  const newRoot = createStandardWorkspace();

  const image = runCli(newRoot, ['image', 'plan', '--root', newRoot, '--profile', 'feat-a']);
  assert.strictEqual(image.profile, 'feat-a');
  assert.strictEqual(image.env, 'build-server');
  assert.strictEqual(image.image, 'registry.example.com/library/llm-d-cuda:v1');
  assert.strictEqual(image.command, 'bash build.sh --build-only');

  const deploy = runCli(newRoot, ['deploy', 'plan', '--root', newRoot, '--set', 'feat-a', '--profile', 'staging']);
  assert.strictEqual(deploy.profile, 'staging');
  assert.strictEqual(deploy.namespace, 'llm-test');
  assert.strictEqual(deploy.commands.deploy, './scripts/deploy.sh');
}

function createBuildProfileWorkspace(changePath) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-image-contract-'));
  const vllm = path.join(root, 'worktrees', 'track', 'vllm');
  fs.mkdirSync(vllm, { recursive: true });
  execFileSync('git', ['init'], { cwd: vllm, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: vllm });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: vllm });
  execFileSync('git', ['checkout', '-b', 'track'], { cwd: vllm, stdio: ['ignore', 'ignore', 'ignore'] });
  writeFile(path.join(vllm, 'README.md'), '# vllm\n');
  execFileSync('git', ['add', '.'], { cwd: vllm });
  execFileSync('git', ['commit', '-m', 'base'], { cwd: vllm, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['tag', 'v0.20.0'], { cwd: vllm });
  writeFile(path.join(vllm, changePath), 'patched\n');
  execFileSync('git', ['add', '.'], { cwd: vllm });
  execFileSync('git', ['commit', '-m', 'patch'], { cwd: vllm, stdio: ['ignore', 'ignore', 'ignore'] });

  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees:',
    '  vllm__track:',
    '    repo: vllm-int',
    '    path: worktrees/track/vllm',
    '    branch: track',
    '    base_ref: v0.20.0',
    'workspace_sets:',
    '  track:',
    '    worktrees: ["vllm__track"]',
    'builders:',
    '  image-builder:',
    '    type: remote_docker',
    '    registry: registry.example.com/library',
    'build_profiles:',
    '  track-image:',
    '    workspace_set: track',
    '    builder: image-builder',
    '    mode: tag_patch_image',
    '    gates:',
    '      require_remote_validation: false',
    '      require_publish: false',
    '    vllm:',
    '      worktree: vllm__track',
    '      base_image: vllm/vllm-openai:v0.20.0-ubuntu2404@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '      patch:',
    '        diff_base: v0.20.0',
    '        include_paths: ["vllm/"]',
    '    image:',
    '      repository: vllm-with-pegaflow',
    '      tag_template: "{track}-{primary_short_sha}"',
    '      primary_worktree: vllm__track',
    'defaults:',
    '  workspace_set: track',
    '  build: track-image',
  ].join('\n') + '\n');
  return { root, vllm };
}

function testImagePlanSupportsTagPatchBuildContract() {
  const { root } = createBuildProfileWorkspace('vllm/engine.py');
  const plan = runCli(root, ['image', 'plan', '--root', root, '--profile', 'track-image']);

  assert.strictEqual(plan.profile, 'track-image');
  assert.strictEqual(plan.mode, 'tag_patch_image');
  assert.strictEqual(plan.builder, 'image-builder');
  assert.strictEqual(plan.registry, 'registry.example.com/library');
  assert.match(plan.image, /^registry\.example\.com\/library\/vllm-with-pegaflow:track-[0-9a-f]+$/);
  assert.deepStrictEqual(plan.missing, []);
  assert.strictEqual(plan.complete, true);
  assert.strictEqual(plan.ready, true);
  assert.strictEqual(plan.gates.remote_validation.status, 'not_required');
  assert.strictEqual(plan.vllm.patch.safe_for_overlay, true);
  assert.deepStrictEqual(plan.vllm.patch.patch_files, ['vllm/engine.py']);
  assert.deepStrictEqual(plan.unsafe_patch_files, []);
  assert.strictEqual(plan.source_heads[0].id, 'vllm__track');
  assert.strictEqual(plan.strategy.mode, 'tag_patch_image');
  assert.deepStrictEqual(plan.strategy.materialize_inputs.vllm_overlay_files, ['vllm/engine.py']);
  assert.ok(plan.strategy.dockerfile_outline.some(line => line.includes('FROM vllm/vllm-openai:v0.20.0-ubuntu2404@sha256:')));
}

function testImagePlanDetectsUnsafeTagPatchFiles() {
  const { root } = createBuildProfileWorkspace('csrc/kernel.cu');
  const plan = runCli(root, ['image', 'plan', '--root', root, '--profile', 'track-image']);

  assert.strictEqual(plan.mode, 'tag_patch_image');
  assert.strictEqual(plan.complete, false);
  assert.strictEqual(plan.status, 'blocked');
  assert.ok(plan.blocked_by.includes('unsafe_patch_files'));
  assert.deepStrictEqual(plan.vllm.patch.unsafe_files, ['csrc/kernel.cu']);
  assert.deepStrictEqual(plan.unsafe_patch_files, ['csrc/kernel.cu']);
  assert.strictEqual(plan.vllm.patch.patch_file_count, 0);
}

function testImagePlanSupportsExplicitRuntimePackagesForTagPatch() {
  const { root, vllm } = createBuildProfileWorkspace('requirements/cuda.txt');
  const configPath = path.join(root, '.devteam', 'config.yaml');
  let config = fs.readFileSync(configPath, 'utf8');
  config = config.replace(
    '        include_paths: ["vllm/"]\n',
    [
      '        include_paths: ["vllm/"]',
      '        allowed_unsafe_paths: ["requirements/cuda.txt"]',
    ].join('\n') + '\n'
  );
  config = config.replace(
    '      base_image: vllm/vllm-openai:v0.20.0-ubuntu2404@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
    [
      '      base_image: vllm/vllm-openai:v0.20.0-ubuntu2404@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '      runtime_pip_packages: ["tokenspeed-mla==0.1.1"]',
    ].join('\n') + '\n'
  );
  fs.writeFileSync(configPath, config, 'utf8');

  const plan = runCli(root, ['image', 'plan', '--root', root, '--profile', 'track-image']);

  assert.strictEqual(plan.mode, 'tag_patch_image');
  assert.strictEqual(plan.complete, true);
  assert.strictEqual(plan.ready, true);
  assert.deepStrictEqual(plan.vllm.patch.raw_unsafe_files, ['requirements/cuda.txt']);
  assert.deepStrictEqual(plan.vllm.patch.allowed_unsafe_files, ['requirements/cuda.txt']);
  assert.deepStrictEqual(plan.unsafe_patch_files, []);
  assert.deepStrictEqual(plan.strategy.materialize_inputs.vllm_runtime_pip_packages, ['tokenspeed-mla==0.1.1']);
  assert.ok(plan.strategy.dockerfile_outline.some(line => line.includes('tokenspeed-mla==0.1.1')));

  const prepared = runCli(root, [
    'image',
    'prepare',
    '--root',
    root,
    '--profile',
    'track-image',
  ]);
  assert.strictEqual(prepared.totals.copied, 0);
  assert.ok(fs.existsSync(path.join(vllm, 'requirements', 'cuda.txt')));
  const dockerfile = fs.readFileSync(path.join(prepared.context_dir, 'Dockerfile.devteam'), 'utf8');
  assert.match(dockerfile, /pip install --no-cache-dir tokenspeed-mla==0\.1\.1/);
}

function testImagePrepareMaterializesTagPatchContext() {
  const { root } = createBuildProfileWorkspace('vllm/engine.py');
  const prepared = runCli(root, [
    'image',
    'prepare',
    '--root',
    root,
    '--profile',
    'track-image',
  ]);

  assert.strictEqual(prepared.action, 'image_prepare');
  assert.strictEqual(prepared.mode, 'tag_patch_image');
  assert.strictEqual(prepared.totals.missing, 0);
  assert.strictEqual(prepared.totals.copied, 1);
  assert.ok(fs.existsSync(path.join(prepared.context_dir, 'Dockerfile.devteam')));
  assert.ok(fs.existsSync(path.join(prepared.context_dir, 'patch-manifest.json')));
  assert.ok(fs.existsSync(path.join(prepared.context_dir, 'source-heads.json')));
  assert.ok(fs.existsSync(path.join(prepared.context_dir, 'verify.sh')));
  assert.ok(fs.existsSync(path.join(prepared.context_dir, 'overlays', 'vllm', 'engine.py')));

  const dockerfile = fs.readFileSync(path.join(prepared.context_dir, 'Dockerfile.devteam'), 'utf8');
  assert.match(dockerfile, /FROM vllm\/vllm-openai:v0\.20\.0-ubuntu2404@sha256:/);
  assert.match(dockerfile, /apply_vllm_overlay\.py/);
}

function testImageAndDeployPlansUseRunGatesAndRecords() {
  const newRoot = createStandardWorkspace();
  initGitRepo(path.join(newRoot, 'repo-a-dev'));
  execFileSync('git', ['-C', path.join(newRoot, 'repo-a-dev'), 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', path.join(newRoot, 'repo-a-dev'), 'config', 'user.name', 'Test User']);
  execFileSync('git', ['-C', path.join(newRoot, 'repo-a-dev'), 'add', '.']);
  execFileSync('git', ['-C', path.join(newRoot, 'repo-a-dev'), 'commit', '-m', 'init'], { stdio: ['ignore', 'ignore', 'ignore'] });

  const session = runCli(newRoot, [
    'session', 'start',
    '--root', newRoot,
    '--set', 'feat-a',
    '--sync', 'build-server',
    '--env', 'build-server',
    '--build', 'feat-a',
    '--deploy', 'staging',
  ]);

  const blockedImage = runCli(newRoot, [
    'image', 'plan',
    '--root', newRoot,
    '--profile', 'feat-a',
    '--run', session.run_id,
  ]);
  assert.strictEqual(blockedImage.run_gate.status, 'blocked');

  runCli(newRoot, [
    'session', 'record',
    '--root', newRoot,
    '--run', session.run_id,
    '--kind', 'env-doctor',
    '--status', 'passed',
    '--summary', 'env doctor passed',
  ]);
  runCli(newRoot, [
    'session', 'record',
    '--root', newRoot,
    '--run', session.run_id,
    '--kind', 'sync',
    '--status', 'passed',
    '--summary', 'sync passed',
  ]);
  runCli(newRoot, [
    'session', 'record',
    '--root', newRoot,
    '--run', session.run_id,
    '--kind', 'test',
    '--status', 'passed',
    '--summary', 'tests passed',
  ]);

  const readyImage = runCli(newRoot, [
    'image', 'plan',
    '--root', newRoot,
    '--profile', 'feat-a',
    '--run', session.run_id,
  ]);
  assert.strictEqual(readyImage.run_gate.status, 'ready');

  const imageRecord = runCli(newRoot, [
    'image', 'record',
    '--root', newRoot,
    '--run', session.run_id,
    '--status', 'passed',
    '--image', 'registry.example.com/library/llm-d-cuda:v2',
    '--digest', 'sha256:abc123',
  ]);
  assert.strictEqual(imageRecord.event.kind, 'image-build');
  assert.strictEqual(imageRecord.event.status, 'passed');

  const deployPlan = runCli(newRoot, [
    'deploy', 'plan',
    '--root', newRoot,
    '--set', 'feat-a',
    '--profile', 'staging',
    '--run', session.run_id,
  ]);
  assert.strictEqual(deployPlan.run_gate.status, 'ready');
  assert.strictEqual(deployPlan.verify_gate.status, 'blocked');

  const waitingForDeployStatus = runCli(newRoot, [
    'session', 'status',
    '--root', newRoot,
    '--run', session.run_id,
  ]);
  assert.strictEqual(waitingForDeployStatus.phase.name, 'preprod-deploy');
  assert.strictEqual(waitingForDeployStatus.phase.status, 'ready');
  assert.strictEqual(waitingForDeployStatus.evidence.deploy.status, 'missing');
  assert.strictEqual(waitingForDeployStatus.evidence['deploy-verify'].status, 'missing');

  const deployRecord = runCli(newRoot, [
    'deploy', 'record',
    '--root', newRoot,
    '--run', session.run_id,
    '--status', 'passed',
    '--namespace', 'llm-test',
    '--image', 'registry.example.com/library/llm-d-cuda:v2',
  ]);
  assert.strictEqual(deployRecord.event.kind, 'deploy');
  assert.strictEqual(deployRecord.event.status, 'passed');

  const waitingForVerifyStatus = runCli(newRoot, [
    'session', 'status',
    '--root', newRoot,
    '--run', session.run_id,
  ]);
  assert.strictEqual(waitingForVerifyStatus.phase.name, 'preprod-verify');
  assert.strictEqual(waitingForVerifyStatus.phase.status, 'ready');
  assert.strictEqual(waitingForVerifyStatus.gates.deploy_verify.status, 'ready');
  assert.ok(waitingForVerifyStatus.next_actions.some(action => action.includes('deploy verify-record')));

  const verifyRecord = runCli(newRoot, [
    'deploy', 'verify-record',
    '--root', newRoot,
    '--run', session.run_id,
    '--status', 'passed',
    '--namespace', 'llm-test',
    '--image', 'registry.example.com/library/llm-d-cuda:v2',
    '--endpoint', 'http://preprod.example.com',
    '--summary', 'preprod smoke passed',
  ]);
  assert.strictEqual(verifyRecord.event.kind, 'deploy-verify');
  assert.strictEqual(verifyRecord.event.status, 'passed');

  const completeStatus = runCli(newRoot, [
    'session', 'status',
    '--root', newRoot,
    '--run', session.run_id,
  ]);
  assert.strictEqual(completeStatus.phase.name, 'preprod-validation-complete');
  assert.strictEqual(completeStatus.phase.status, 'complete');
  assert.strictEqual(completeStatus.evidence['deploy-verify'].status, 'passed');

  const readme = fs.readFileSync(session.readme_path, 'utf8');
  assert.match(readme, /- Image build: passed/);
  assert.match(readme, /- Deploy: passed/);
  assert.match(readme, /- Deploy verify: passed/);
  assert.match(readme, /registry\.example\.com\/library\/llm-d-cuda:v2/);
}

function testImageRecordCanEnableOptionalBuildProfileOnRun() {
  const newRoot = createStandardWorkspace('devteam-workspace-optional-image-');
  initGitRepo(path.join(newRoot, 'repo-a-dev'));
  execFileSync('git', ['-C', path.join(newRoot, 'repo-a-dev'), 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', path.join(newRoot, 'repo-a-dev'), 'config', 'user.name', 'Test User']);
  execFileSync('git', ['-C', path.join(newRoot, 'repo-a-dev'), 'add', '.']);
  execFileSync('git', ['-C', path.join(newRoot, 'repo-a-dev'), 'commit', '-m', 'init'], { stdio: ['ignore', 'ignore', 'ignore'] });

  const session = runCli(newRoot, [
    'session', 'start',
    '--root', newRoot,
    '--set', 'feat-a',
    '--sync', 'build-server',
    '--env', 'build-server',
    '--no-build',
    '--no-deploy',
  ]);
  assert.strictEqual(session.profiles.build, null);

  for (const kind of ['env-doctor', 'sync', 'test']) {
    runCli(newRoot, [
      'session', 'record',
      '--root', newRoot,
      '--run', session.run_id,
      '--kind', kind,
      '--status', 'passed',
      '--summary', `${kind} passed`,
    ]);
  }

  const imageRecord = runCli(newRoot, [
    'image', 'record',
    '--root', newRoot,
    '--run', session.run_id,
    '--profile', 'feat-a',
    '--status', 'passed',
    '--image', 'registry.example.com/library/llm-d-cuda:v3',
  ]);
  assert.strictEqual(imageRecord.event.kind, 'image-build');
  assert.deepStrictEqual(imageRecord.profile_patch, { build: 'feat-a' });
  assert.strictEqual(imageRecord.session_updated, true);

  const sessionJson = JSON.parse(fs.readFileSync(path.join(newRoot, '.devteam', 'runs', session.run_id, 'session.json'), 'utf8'));
  assert.strictEqual(sessionJson.profiles.build, 'feat-a');

  const status = runCli(newRoot, [
    'session', 'status',
    '--root', newRoot,
    '--run', session.run_id,
  ]);
  assert.strictEqual(status.profiles.build, 'feat-a');
  assert.strictEqual(status.image.profile, 'feat-a');
  assert.strictEqual(status.evidence['image-build'].status, 'passed');
  assert.strictEqual(status.phase.name, 'image-validation-complete');
  assert.strictEqual(status.phase.status, 'complete');
}

function testDeployRecordCanEnableOptionalDeployProfileOnRun() {
  const newRoot = createStandardWorkspace('devteam-workspace-optional-deploy-');
  initGitRepo(path.join(newRoot, 'repo-a-dev'));
  execFileSync('git', ['-C', path.join(newRoot, 'repo-a-dev'), 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', path.join(newRoot, 'repo-a-dev'), 'config', 'user.name', 'Test User']);
  execFileSync('git', ['-C', path.join(newRoot, 'repo-a-dev'), 'add', '.']);
  execFileSync('git', ['-C', path.join(newRoot, 'repo-a-dev'), 'commit', '-m', 'init'], { stdio: ['ignore', 'ignore', 'ignore'] });

  const session = runCli(newRoot, [
    'session', 'start',
    '--root', newRoot,
    '--set', 'feat-a',
    '--sync', 'build-server',
    '--env', 'build-server',
    '--build', 'feat-a',
    '--no-deploy',
  ]);
  assert.strictEqual(session.profiles.deploy, null);

  for (const kind of ['env-doctor', 'sync', 'test', 'image-build']) {
    runCli(newRoot, [
      'session', 'record',
      '--root', newRoot,
      '--run', session.run_id,
      '--kind', kind,
      '--status', 'passed',
      '--summary', `${kind} passed`,
    ]);
  }

  const deployRecord = runCli(newRoot, [
    'deploy', 'record',
    '--root', newRoot,
    '--run', session.run_id,
    '--profile', 'staging',
    '--status', 'passed',
    '--namespace', 'llm-test',
    '--image', 'registry.example.com/library/llm-d-cuda:v3',
  ]);
  assert.strictEqual(deployRecord.event.kind, 'deploy');
  assert.deepStrictEqual(deployRecord.profile_patch, { deploy: 'staging' });
  assert.strictEqual(deployRecord.session_updated, true);

  const sessionJson = JSON.parse(fs.readFileSync(path.join(newRoot, '.devteam', 'runs', session.run_id, 'session.json'), 'utf8'));
  assert.strictEqual(sessionJson.profiles.deploy, 'staging');

  const status = runCli(newRoot, [
    'session', 'status',
    '--root', newRoot,
    '--run', session.run_id,
  ]);
  assert.strictEqual(status.profiles.deploy, 'staging');
  assert.strictEqual(status.deploy.profile, 'staging');
  assert.strictEqual(status.evidence.deploy.status, 'passed');
  assert.strictEqual(status.phase.name, 'preprod-verify');
  assert.strictEqual(status.phase.status, 'ready');
}

function testSessionSnapshotWritesRunArtifact() {
  const newRoot = createStandardWorkspace();
  initGitRepo(path.join(newRoot, 'repo-a-dev'));

  const session = runCli(newRoot, [
    'session', 'snapshot',
    '--root', newRoot,
    '--set', 'feat-a',
    '--sync', 'build-server',
    '--build', 'feat-a',
    '--deploy', 'staging',
  ]);
  assert.strictEqual(session.action, 'snapshot');
  assert.strictEqual(session.status, 'ready');
  assert.ok(fs.existsSync(session.path));

  const payload = JSON.parse(fs.readFileSync(session.path, 'utf8'));
  assert.strictEqual(payload.workspace_set, 'feat-a');
  assert.strictEqual(payload.profiles.env, 'build-server');
  assert.strictEqual(payload.sync_plan.totals.syncable, 1);
  assert.strictEqual(payload.image_plan.command, 'bash build.sh --build-only');
}

function testSessionStartWritesReadmeAndCanSkipBuildDeploy() {
  const newRoot = createStandardWorkspace();
  initGitRepo(path.join(newRoot, 'repo-a-dev'));

  const session = runCli(newRoot, [
    'session', 'start',
    '--root', newRoot,
    '--set', 'feat-a',
    '--sync', 'build-server',
    '--env', 'build-server',
    '--no-build',
    '--no-deploy',
    '--note', 'remote source validation',
  ]);

  assert.strictEqual(session.action, 'start');
  assert.strictEqual(session.status, 'ready');
  assert.ok(fs.existsSync(session.path));
  assert.ok(fs.existsSync(session.readme_path));

  const payload = JSON.parse(fs.readFileSync(session.path, 'utf8'));
  assert.strictEqual(payload.profiles.build, null);
  assert.strictEqual(payload.profiles.deploy, null);
  assert.strictEqual(payload.image_plan, null);
  assert.strictEqual(payload.deploy_plan, null);

  const readme = fs.readFileSync(session.readme_path, 'utf8');
  assert.match(readme, /# /);
  assert.match(readme, /remote source validation/);
  assert.match(readme, /env doctor/);
  assert.match(readme, new RegExp(`env doctor[^\\n]+--run "${session.run_id}"`));
  assert.match(readme, /env refresh/);
  assert.match(readme, /sync plan/);
  assert.match(readme, new RegExp(`--run "${session.run_id}"`));
  assert.doesNotMatch(readme, /image plan/);
  assert.doesNotMatch(readme, /deploy plan/);
}

function testSessionRecordAppendsEventAndUpdatesReadme() {
  const newRoot = createStandardWorkspace();
  initGitRepo(path.join(newRoot, 'repo-a-dev'));

  const session = runCli(newRoot, [
    'session', 'start',
    '--root', newRoot,
    '--set', 'feat-a',
    '--sync', 'build-server',
    '--env', 'build-server',
    '--no-build',
    '--no-deploy',
  ]);

  const record = runCli(newRoot, [
    'session', 'record',
    '--root', newRoot,
    '--run', session.run_id,
    '--kind', 'env-doctor',
    '--status', 'passed',
    '--summary', 'remote venv doctor passed',
    '--command', 'devteam env doctor --remote',
    '--log', '/remote/logs/env-doctor.log',
  ]);

  assert.strictEqual(record.action, 'record');
  assert.strictEqual(record.run_id, session.run_id);
  assert.ok(fs.existsSync(record.events_path));

  const events = fs.readFileSync(record.events_path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].kind, 'env-doctor');
  assert.strictEqual(events[0].status, 'passed');

  const readme = fs.readFileSync(record.readme_path, 'utf8');
  assert.match(readme, /- Env doctor: passed/);
  assert.match(readme, /## Event Log/);
  assert.match(readme, /remote venv doctor passed/);
  assert.match(readme, /devteam env doctor --remote/);
  assert.match(readme, /\/remote\/logs\/env-doctor\.log/);
}

function testSessionRecordCanParsePytestLog() {
  const newRoot = createStandardWorkspace();
  initGitRepo(path.join(newRoot, 'repo-a-dev'));

  const session = runCli(newRoot, [
    'session', 'start',
    '--root', newRoot,
    '--set', 'feat-a',
    '--sync', 'build-server',
    '--env', 'build-server',
    '--no-build',
    '--no-deploy',
  ]);
  const logPath = path.join(newRoot, 'pytest.log');
  writeFile(logPath, [
    'tests/example/test_a.py::test_a PASSED [100%]',
    '======================= 54 passed, 2 skipped, 22 warnings in 219.85s =======================',
  ].join('\n') + '\n');

  const record = runCli(newRoot, [
    'session', 'record',
    '--root', newRoot,
    '--run', session.run_id,
    '--pytest-log', logPath,
    '--command', 'python -m pytest tests/example/test_a.py',
  ]);

  assert.strictEqual(record.event.kind, 'test');
  assert.strictEqual(record.event.status, 'passed');
  assert.match(record.event.summary, /54 passed, 2 skipped, 22 warnings in 219\.85s/);
  assert.strictEqual(record.event.log, logPath);

  const readme = fs.readFileSync(record.readme_path, 'utf8');
  assert.match(readme, /- Tests: passed/);
  assert.match(readme, /python -m pytest tests\/example\/test_a\.py/);
}

function testSessionRecordCanParseFailedPytestLog() {
  const newRoot = createStandardWorkspace();
  initGitRepo(path.join(newRoot, 'repo-a-dev'));

  const session = runCli(newRoot, [
    'session', 'start',
    '--root', newRoot,
    '--set', 'feat-a',
    '--sync', 'build-server',
    '--env', 'build-server',
    '--no-build',
    '--no-deploy',
  ]);
  const logPath = path.join(newRoot, 'pytest-failed.log');
  writeFile(logPath, [
    'FAILED tests/example/test_a.py::test_a - AssertionError',
    '============ 1 failed, 23 passed, 2 skipped, 24 warnings in 398.46s ============',
  ].join('\n') + '\n');

  const record = runCli(newRoot, [
    'session', 'record',
    '--root', newRoot,
    '--run', session.run_id,
    '--from-pytest-log', logPath,
  ]);

  assert.strictEqual(record.event.kind, 'test');
  assert.strictEqual(record.event.status, 'failed');
  assert.match(record.event.summary, /1 failed, 23 passed, 2 skipped/);

  const readme = fs.readFileSync(record.readme_path, 'utf8');
  assert.match(readme, /- Tests: failed/);
}

function testSessionRecordCanParseRemotePytestLog() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-remote-pytest-'));
  const logPath = path.join(root, 'remote-pytest.log');
  writeFile(logPath, [
    'tests/example/test_remote.py::test_remote PASSED [100%]',
    '======================= 60 passed, 16 warnings in 14.30s =======================',
  ].join('\n') + '\n');
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees: {}',
    'workspace_sets:',
    '  empty:',
    '    worktrees: []',
    'env_profiles:',
    '  remote-shell:',
    '    type: remote_dev',
    '    ssh: "sh -c"',
    '    host: "local-shell"',
    '    source_dir: "/tmp"',
    'defaults:',
    '  workspace_set: empty',
    '  env: remote-shell',
    '  sync: remote-shell',
  ].join('\n') + '\n');

  const session = runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'empty',
    '--sync', 'remote-shell',
    '--env', 'remote-shell',
    '--no-build',
    '--no-deploy',
  ]);
  const record = runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', session.run_id,
    '--remote-pytest-log', logPath,
    '--command', 'python -m pytest tests/example/test_remote.py',
  ]);

  assert.strictEqual(record.event.kind, 'test');
  assert.strictEqual(record.event.status, 'passed');
  assert.strictEqual(record.event.log, logPath);
  assert.match(record.event.summary, /60 passed, 16 warnings in 14\.30s/);

  const readme = fs.readFileSync(record.readme_path, 'utf8');
  assert.match(readme, /- Tests: passed/);
}

function testSyncApplyCanAutoRecordToSessionRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-sync-record-'));
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees: {}',
    'workspace_sets:',
    '  empty:',
    '    worktrees: []',
    'env_profiles:',
    '  local:',
    '    type: local',
    'defaults:',
    '  workspace_set: empty',
    '  env: local',
    '  sync: local',
  ].join('\n') + '\n');

  const session = runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'empty',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
  ]);

  const sync = runCli(root, [
    'sync', 'apply',
    '--root', root,
    '--set', 'empty',
    '--profile', 'local',
    '--yes',
    '--run', session.run_id,
  ]);

  assert.strictEqual(sync.status, 'applied');
  assert.strictEqual(sync.record.event.kind, 'sync');
  assert.strictEqual(sync.record.event.status, 'passed');

  const readme = fs.readFileSync(session.readme_path, 'utf8');
  assert.match(readme, /- Sync: passed/);
  assert.match(readme, /sync apply applied/);
}

function testEnvRefreshCanAutoRecordToSessionRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-env-record-'));
  const source = path.join(root, 'remote', 'vllm-int');
  const venv = path.join(root, 'remote', 'venvs', 'vllm-track');
  const python = path.join(venv, 'bin', 'python');
  const uv = path.join(root, 'bin', 'uv');

  writeFile(path.join(source, 'README.md'), '# fake vllm\n');
  fs.mkdirSync(path.join(source, 'vllm'), { recursive: true });
  writeFile(path.join(source, 'vllm', '__init__.py'), '');
  execFileSync('git', ['init'], { cwd: source, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: source });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: source });
  execFileSync('git', ['add', '.'], { cwd: source });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: source, stdio: ['ignore', 'ignore', 'ignore'] });

  writeFile(python, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "Python 3.12.12"; exit 0; fi',
    'echo "python 3.12.12"',
    'echo "prefix ${VIRTUAL_ENV:-/fake/venv}"',
    'echo "site_packages ${VIRTUAL_ENV:-/fake/venv}/lib/python3.12/site-packages"',
    'echo "vllm_version 0.0.0+fake.precompiled"',
    'echo "vllm_file $(pwd)/vllm/__init__.py"',
  ].join('\n') + '\n');
  fs.chmodSync(python, 0o755);
  writeFile(uv, '#!/bin/sh\necho "uv fake install" >&2\nexit 0\n');
  fs.chmodSync(uv, 0o755);

  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees: {}',
    'workspace_sets:',
    '  empty:',
    '    worktrees: []',
    'env_profiles:',
    '  remote-vllm:',
    '    type: remote_dev',
    '    ssh: "sh -c"',
    '    host: "local-shell"',
    `    source_dir: "${source}"`,
    `    venv: "${venv}"`,
    `    python: "${python}"`,
    `    uv: "${uv}"`,
    '    install_mode: editable-precompiled',
    'defaults:',
    '  workspace_set: empty',
    '  env: remote-vllm',
    '  sync: remote-vllm',
  ].join('\n') + '\n');

  const session = runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'empty',
    '--sync', 'remote-vllm',
    '--env', 'remote-vllm',
    '--no-build',
    '--no-deploy',
  ]);

  const refresh = runCli(root, [
    'env', 'refresh',
    '--root', root,
    '--profile', 'remote-vllm',
    '--yes',
    '--run', session.run_id,
  ]);

  assert.strictEqual(refresh.status, 'passed');
  assert.strictEqual(refresh.record.event.kind, 'env-refresh');
  assert.strictEqual(refresh.record.event.status, 'passed');
  assert.match(refresh.record.event.summary, /vllm_version 0\.0\.0\+fake\.precompiled/);

  const readme = fs.readFileSync(session.readme_path, 'utf8');
  assert.match(readme, /- Env refresh: passed/);
  assert.match(readme, /vllm_version 0\.0\.0\+fake\.precompiled/);
}

function testEnvDoctorCanAutoRecordToSessionRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-env-doctor-record-'));
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees: {}',
    'workspace_sets:',
    '  empty:',
    '    worktrees: []',
    'env_profiles:',
    '  local:',
    '    type: local',
    'defaults:',
    '  workspace_set: empty',
    '  env: local',
    '  sync: local',
  ].join('\n') + '\n');

  const session = runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'empty',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
  ]);

  const doctor = runCli(root, [
    'env', 'doctor',
    '--root', root,
    '--profile', 'local',
    '--run', session.run_id,
  ]);

  assert.strictEqual(doctor.status, 'pass');
  assert.strictEqual(doctor.record.event.kind, 'env-doctor');
  assert.strictEqual(doctor.record.event.status, 'passed');
  assert.match(doctor.record.event.summary, /env doctor pass for local \(local\)/);

  const readme = fs.readFileSync(session.readme_path, 'utf8');
  assert.match(readme, /- Env doctor: passed/);
  assert.match(readme, /env doctor pass for local \(local\)/);
}

function testWorkspaceScaffoldCreatesCleanSkeleton() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-skeleton-'));
  const result = runCli(root, [
    'workspace',
    'scaffold',
    '--root',
    root,
    '--name',
    'skeleton-test',
  ]);

  assert.strictEqual(result.action, 'workspace_scaffold');
  assert.strictEqual(result.name, 'skeleton-test');
  assert.ok(fs.existsSync(path.join(root, '.devteam', 'config.yaml')));
  assert.ok(fs.existsSync(path.join(root, '.devteam', 'recipes', 'remote-test-loop.md')));
  assert.ok(fs.existsSync(path.join(root, '.devteam', 'wiki', 'index.md')));
  assert.ok(fs.existsSync(path.join(root, '.devteam', 'skills', 'README.md')));
  assert.strictEqual(fs.existsSync(path.join(root, '.devteam', 'knowledge')), false);

  const doctor = runCli(root, ['doctor', '--root', root]);
  assert.strictEqual(doctor.status, 'pass');
  assert.strictEqual(doctor.workspace_status.worktrees, 0);
}

function testWorkspaceOnboardingContextTrackContextAndHandoff() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-onboarding-'));
  const repoPath = path.join(root, 'repos', 'repo-a');
  initGitRepo(repoPath);
  execFileSync('git', ['config', 'user.email', 'devteam@example.com'], { cwd: repoPath });
  execFileSync('git', ['config', 'user.name', 'Devteam Test'], { cwd: repoPath });
  execFileSync('git', ['add', 'README.md'], { cwd: repoPath });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoPath, stdio: ['ignore', 'ignore', 'ignore'] });

  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'name: onboarding-test',
    'agent_onboarding:',
    '  old_workspace:',
    '    path: "/tmp/old-devteam-workspace"',
    '    policy: "read-only"',
    'worktrees:',
    '  repo_a__feature:',
    '    repo: repo-a',
    '    path: repos/repo-a',
    '    branch: master',
    '    base_ref: HEAD',
    '    roles: ["source", "remote-test"]',
    '    sync:',
    '      profile: remote-test-feature',
    '      remote_path: /remote/devteam/feature/repo-a',
    'workspace_sets:',
    '  feature-a:',
    '    description: Feature A validation track',
    '    aliases: [feat-a]',
    '    status: active',
    '    worktrees: ["repo_a__feature"]',
    '  old-track:',
    '    status: archived',
    '    worktrees: []',
    'env_profiles:',
    '  remote-test-feature:',
    '    type: remote_dev',
    '    ssh: "ssh root@example.com"',
    '    host: "root@example.com"',
    '    source_dir: "/remote/devteam/feature/repo-a"',
    '    venv: "/remote/venvs/feature-a"',
    '    python: "/remote/venvs/feature-a/bin/python"',
    '  local:',
    '    type: local',
    'build_profiles:',
    '  feature-a-image:',
    '    workspace_set: feature-a',
    '    mode: tag_patch_image',
    'defaults:',
    '  workspace_set: feature-a',
    '  env: remote-test-feature',
    '  sync: remote-test-feature',
    '  build: feature-a-image',
  ].join('\n') + '\n');

  const plan = runCli(root, ['workspace', 'onboard', '--root', root]);
  assert.strictEqual(plan.action, 'workspace_onboard');
  assert.strictEqual(plan.status, 'planned');
  assert.ok(plan.files.some(file => file.name === 'AGENTS.md' && file.state === 'missing'));

  const written = runCli(root, ['workspace', 'onboard', '--root', root, '--write']);
  assert.strictEqual(written.status, 'applied');
  assert.ok(fs.existsSync(path.join(root, 'AGENTS.md')));
  assert.ok(fs.existsSync(path.join(root, 'CLAUDE.md')));
  assert.ok(fs.existsSync(path.join(root, 'README.devteam.md')));
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /workspace context --root "\$PWD" --for codex --text/);
  assert.match(agents, /Feature A validation track/);
  assert.match(agents, /\/tmp\/old-devteam-workspace/);

  const context = runCli(root, ['workspace', 'context', '--root', root, '--for', 'codex']);
  assert.strictEqual(context.action, 'workspace_context');
  assert.strictEqual(context.name, 'onboarding-test');
  assert.strictEqual(context.default_track, 'feature-a');
  assert.strictEqual(context.selected_track, null);
  assert.strictEqual(context.tracks.active[0].name, 'feature-a');
  assert.strictEqual(context.tracks.archived[0].name, 'old-track');
  assert.match(context.recommended_commands.track_picker, /track/);

  const contextText = runCliText(root, ['workspace', 'context', '--root', root, '--for', 'codex', '--text']);
  assert.match(contextText, /Devteam Workspace Context/);
  assert.match(contextText, /Choose a track before editing code/);

  const trackContext = runCli(root, ['track', 'context', '--root', root, '--set', 'feat-a']);
  assert.strictEqual(trackContext.action, 'track_context');
  assert.strictEqual(trackContext.track.name, 'feature-a');
  assert.strictEqual(trackContext.profiles.env.venv, '/remote/venvs/feature-a');
  assert.strictEqual(trackContext.worktrees[0].exists, true);

  const trackText = runCliText(root, ['track', 'context', '--root', root, '--set', 'feat-a', '--text']);
  assert.match(trackText, /Track Context/);
  assert.match(trackText, /remote-test-feature/);
  assert.match(trackText, /\/remote\/venvs\/feature-a/);

  const session = runCli(root, [
    'session',
    'start',
    '--root',
    root,
    '--set',
    'feature-a',
    '--no-deploy',
  ]);
  runCli(root, [
    'session',
    'record',
    '--root',
    root,
    '--set',
    'feature-a',
    '--run',
    session.run_id,
    '--kind',
    'test',
    '--status',
    'passed',
    '--summary',
    'pytest passed: 1 passed',
  ]);

  const handoff = runCli(root, ['session', 'handoff', '--root', root, '--set', 'feature-a']);
  assert.strictEqual(handoff.action, 'session_handoff');
  assert.strictEqual(handoff.workspace_set, 'feature-a');
  assert.strictEqual(handoff.verified.find(item => item.kind === 'test').status, 'passed');
  assert.ok(handoff.do_not.some(item => item.includes('remote state')));

  const handoffText = runCliText(root, ['session', 'handoff', '--root', root, '--set', 'feature-a', '--text']);
  assert.match(handoffText, /Session Handoff/);
  assert.match(handoffText, /test: passed/);

  const doctor = runCli(root, ['doctor', 'agent-onboarding', '--root', root]);
  assert.strictEqual(doctor.action, 'agent_onboarding_doctor');
  assert.strictEqual(doctor.status, 'pass');
  assert.strictEqual(doctor.totals.errors, 0);

  const doctorText = runCliText(root, ['doctor', 'agent-onboarding', '--root', root, '--text']);
  assert.match(doctorText, /agent_context_command|agents_context_command/);
  assert.match(doctorText, /workspace context can be generated/);
}

function testKnowledgeListSearchLintAndCaptureRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-knowledge-'));
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees: {}',
    'workspace_sets:',
    '  empty:',
    '    worktrees: []',
    'env_profiles:',
    '  local:',
    '    type: local',
    'knowledge:',
    '  recipes_dir: ".devteam/recipes"',
    '  wiki_dir: ".devteam/wiki"',
    '  skills_dir: ".devteam/skills"',
    'defaults:',
    '  workspace_set: empty',
    '  env: local',
    '  sync: local',
  ].join('\n') + '\n');
  writeFile(path.join(root, '.devteam', 'wiki', 'index.md'), [
    '# Wiki Index',
    '',
    '- [Remote vLLM Venv Standard](remote-vllm-venv-standard.md)',
  ].join('\n') + '\n');
  writeFile(path.join(root, '.devteam', 'wiki', 'remote-vllm-venv-standard.md'), [
    '# Remote vLLM Venv Standard',
    '',
    'Use one source mirror and one venv per track.',
  ].join('\n') + '\n');
  writeFile(path.join(root, '.devteam', 'recipes', 'remote-test-loop.md'), [
    '# Remote Test Loop',
    '',
    'Sync selected files, run pytest, and record evidence.',
  ].join('\n') + '\n');
  writeFile(path.join(root, '.devteam', 'skills', 'README.md'), '# Skills\n');

  const list = runCli(root, ['knowledge', 'list', '--root', root]);
  assert.strictEqual(list.action, 'knowledge_list');
  assert.strictEqual(list.totals.wiki, 2);
  assert.strictEqual(list.totals.recipes, 1);
  assert.strictEqual(list.totals.skills, 1);

  const search = runCli(root, ['knowledge', 'search', 'source mirror', '--root', root, '--type', 'wiki']);
  assert.strictEqual(search.action, 'knowledge_search');
  assert.strictEqual(search.total_matches, 1);
  assert.strictEqual(search.matches[0].title, 'Remote vLLM Venv Standard');

  const lint = runCli(root, ['knowledge', 'lint', '--root', root]);
  assert.strictEqual(lint.status, 'pass');
  assert.strictEqual(lint.totals.problems, 0);

  const session = runCli(root, [
    'session', 'start',
    '--root', root,
    '--set', 'empty',
    '--sync', 'local',
    '--env', 'local',
    '--no-build',
    '--no-deploy',
  ]);
  runCli(root, [
    'session', 'record',
    '--root', root,
    '--run', session.run_id,
    '--kind', 'test',
    '--status', 'passed',
    '--summary', 'pytest passed: 1 passed in 0.1s',
    '--command', 'python -m pytest tests/example.py',
  ]);

  const draft = runCli(root, [
    'knowledge',
    'capture',
    '--root',
    root,
    '--run',
    session.run_id,
    '--title',
    'Remote Test Lesson',
    '--summary',
    'Record the exact pytest command after remote validation.',
  ]);
  assert.strictEqual(draft.applied, false);
  assert.match(draft.content, /# Remote Test Lesson/);
  assert.match(draft.content, /pytest passed: 1 passed/);
  assert.strictEqual(fs.existsSync(draft.target_path), false);

  const applied = runCli(root, [
    'knowledge',
    'capture',
    '--root',
    root,
    '--run',
    session.run_id,
    '--title',
    'Remote Test Lesson',
    '--summary',
    'Record the exact pytest command after remote validation.',
    '--apply',
  ]);
  assert.strictEqual(applied.applied, true);
  assert.ok(fs.existsSync(applied.target_path));
  assert.match(fs.readFileSync(applied.target_path, 'utf8'), /python -m pytest tests\/example\.py/);
  assert.match(fs.readFileSync(path.join(root, '.devteam', 'wiki', 'index.md'), 'utf8'), /Remote Test Lesson/);
}

function testSkillListLintAndInstallUsesExplicitTarget() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-skills-'));
  const target = path.join(root, 'agent-skills');
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees: {}',
    'workspace_sets:',
    '  empty:',
    '    worktrees: []',
    'env_profiles:',
    '  local:',
    '    type: local',
    'knowledge:',
    '  skills_dir: ".devteam/skills"',
    'defaults:',
    '  workspace_set: empty',
    '  env: local',
  ].join('\n') + '\n');
  writeFile(path.join(root, '.devteam', 'skills', 'README.md'), '# Skills\n');

  const list = runCli(root, ['skill', 'list', '--root', root, '--target', target]);
  const statusSkill = list.entries.find(entry => entry.name === 'devteam-status');
  assert.ok(statusSkill);
  assert.strictEqual(statusSkill.scope, 'repo');
  assert.strictEqual(statusSkill.status, 'missing');
  assert.strictEqual(statusSkill.installed, false);

  const lint = runCli(root, ['skill', 'lint', '--root', root, '--target', target]);
  assert.strictEqual(lint.status, 'pass');
  assert.strictEqual(lint.totals.problems, 0);

  const dryRun = runCli(root, [
    'skill',
    'install',
    'devteam-status',
    '--root',
    root,
    '--target',
    target,
  ]);
  assert.strictEqual(dryRun.dry_run, true);
  assert.strictEqual(dryRun.status, 'planned');
  assert.strictEqual(fs.existsSync(path.join(target, 'devteam-status')), false);

  const installed = runCli(root, [
    'skill',
    'install',
    'devteam-status',
    '--root',
    root,
    '--target',
    target,
    '--yes',
  ]);
  assert.strictEqual(installed.status, 'applied');
  assert.strictEqual(installed.totals.installed, 1);
  assert.ok(fs.existsSync(path.join(target, 'devteam-status', 'SKILL.md')));

  const afterInstall = runCli(root, ['skill', 'status', '--root', root, '--target', target]);
  const installedSkill = afterInstall.entries.find(entry => entry.name === 'devteam-status');
  assert.strictEqual(installedSkill.status, 'current');

  fs.appendFileSync(path.join(target, 'devteam-status', 'SKILL.md'), '\n<!-- local edit -->\n');
  const drift = runCli(root, ['skill', 'list', '--root', root, '--target', target]);
  const driftSkill = drift.entries.find(entry => entry.name === 'devteam-status');
  assert.strictEqual(driftSkill.status, 'drift');

  const text = runCliText(root, ['skill', 'list', '--root', root, '--target', target, '--text']);
  assert.match(text, /devteam-status\s+repo\s+drift/);
}

function testRemoteDevVllmProfileChecksSourceVenvAndImport() {
  const checks = remoteChecksForProfile({
    type: 'remote_dev',
    source_dir: '/ppio1/devteam/kimi-pd-pegaflow-v0201/vllm-int',
    venv: '/ppio1/venvs/vllm-kimi-pd-pegaflow-v0201',
    python: '/ppio1/venvs/vllm-kimi-pd-pegaflow-v0201/bin/python',
    site_packages: '/ppio1/venvs/vllm-kimi-pd-pegaflow-v0201/lib/python3.12/site-packages',
  });

  assert.ok(checks.some(command => command.includes('source_dir_ok')));
  assert.ok(checks.some(command => command.includes('git describe --tags --match')));
  assert.ok(checks.some(command => command.includes('venv_ok')));
  assert.ok(checks.some(command => command.includes('site_packages_ok')));
  assert.ok(checks.some(command => command.includes('vllm_version')));
  assert.ok(checks.some(command => command.includes('inspect.getfile(vllm)')));
}

function testRemoteDevProfileWithoutVllmSkipsImportCheck() {
  const checks = remoteChecksForProfile({
    type: 'remote_dev',
    source_dir: '/srv/app',
    venv: '/srv/venvs/app',
    python: '/srv/venvs/app/bin/python',
  });

  assert.ok(checks.some(command => command.includes('source_dir_ok')));
  assert.ok(checks.every(command => !command.includes('import vllm')));
}

function testVllmRefreshCommandUsesEditablePrecompiledInstall() {
  const command = buildVllmRefreshCommand({
    type: 'remote_dev',
    source_dir: '/ppio1/devteam/kimi-pd-pegaflow-v0201/vllm-int',
    venv: '/ppio1/venvs/vllm-kimi-pd-pegaflow-v0201',
    python: '/ppio1/venvs/vllm-kimi-pd-pegaflow-v0201/bin/python',
    site_packages: '/ppio1/venvs/vllm-kimi-pd-pegaflow-v0201/lib/python3.12/site-packages',
    install_mode: 'editable-precompiled',
    proxy: {
      all_proxy: 'socks5h://172.17.0.1:1080',
      http_proxy: 'http://172.17.0.1:1081',
      no_proxy: 'localhost,127.0.0.1',
      uv_link_mode: 'copy',
      uv_http_timeout_seconds: 120,
    },
  });

  assert.match(command, /git status --short --branch/);
  assert.match(command, /git describe --tags --match 'v\*' --always/);
  assert.match(command, /VLLM_USE_PRECOMPILED=1/);
  assert.match(command, /uv' pip install/);
  assert.match(command, /-e \. --torch-backend=auto/);
  assert.match(command, /vllm_version/);
  assert.match(command, /ALL_PROXY='socks5h:\/\/172\.17\.0\.1:1080'/);
  assert.match(command, /UV_LINK_MODE='copy'/);
}

function testEnvRefreshDefaultsToDryRunPlan() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-env-refresh-'));
  writeFile(path.join(root, '.devteam', 'config.yaml'), [
    'version: 2',
    `workspace: ${root}`,
    'worktrees: {}',
    'workspace_sets: {}',
    'env_profiles:',
    '  remote-vllm:',
    '    type: remote_dev',
    '    ssh: "ssh root@example.com"',
    '    host: "root@example.com"',
    '    source_dir: "/remote/vllm-int"',
    '    venv: "/remote/venvs/vllm-track"',
    '    python: "/remote/venvs/vllm-track/bin/python"',
    '    site_packages: "/remote/venvs/vllm-track/lib/python3.12/site-packages"',
    '    install_mode: editable-precompiled',
    'defaults:',
    '  env: remote-vllm',
  ].join('\n') + '\n');

  const result = runCli(root, ['env', 'refresh', '--root', root, '--profile', 'remote-vllm']);
  assert.strictEqual(result.action, 'env_refresh');
  assert.strictEqual(result.dry_run, true);
  assert.strictEqual(result.status, 'planned');
  assert.match(result.command, /VLLM_USE_PRECOMPILED=1/);
  assert.strictEqual(result.result, undefined);
}

function main() {
  testYamlDoubleQuotedEscapesForShellCommands();
  testWorkspaceStatusShowsMissingAndSource();
  testWorkspaceStatusSurfacesPublishPlan();
  testWorkspaceStatusIncludesDirtyFileSummary();
  testWorkspacePublishPlanSurfacesPushCommands();
  testWorkspacePublishRequiresGateAndRecordsPush();
  testWorkspacePublishDetectsAlreadyPublishedRemoteAhead();
  testSessionStatusPublishNextActionForAlreadyPublishedBranch();
  testSessionStartSuggestsPublishPlanWhenNeeded();
  testSessionStatusSummarizesEvidenceAndPublishPlan();
  testSessionStatusMarksEvidenceStaleWhenWorktreeHeadChanges();
  testSessionListSummarizesRunHistoryAndFiltersByTrack();
  testSessionLifecycleCanCloseStaleRunsOutOfActiveHistory();
  testSessionSupersedeStaleOnlyClosesOlderRuns();
  testTrackListStatusAndUseUpdatesDefaults();
  testRemoteLoopStartDoctorSyncRecordAndStatus();
  testRemoteLoopIgnoresClosedRunsWhenResolvingLatest();
  testRemoteLoopPlanDoesNotReuseStaleRunForEvidenceWriters();
  testSessionLocalTrackEnvKeepsWorkspaceDefaultUntouched();
  testSessionRecordBlocksCrossTrackEvidence();
  testSessionRecordBlocksStaleHeadEvidence();
  testPresenceTouchListClearAndTrackRuntime();
  testConsoleTouchesStablePresenceAndShowsSessionCount();
  testConsoleHidesMutatingRunCommandsForStaleRun();
  testStatusSkillDisplaysDtShortcuts();
  testStatusSkillScopesHistoryToSelectedTrack();
  testRemoteLoopRecordTestBlocksCrossTrackRun();
  testMaterializePlansLocalCloneFromSourcePath();
  testSyncPlanBecomesSyncableWhenWorktreeExists();
  testSyncApplyDefaultsToDryRunPlan();
  testSyncPlanCanIncludeWorkspaceAssets();
  testSyncPatchModesSeparateBranchPatchFromDirtyOnly();
  testDoctorAggregatesWorkspaceChecks();
  testImageAndDeployPlansUseConfiguredProfiles();
  testImagePlanSupportsTagPatchBuildContract();
  testImagePlanDetectsUnsafeTagPatchFiles();
  testImagePrepareMaterializesTagPatchContext();
  testImageAndDeployPlansUseRunGatesAndRecords();
  testImageRecordCanEnableOptionalBuildProfileOnRun();
  testDeployRecordCanEnableOptionalDeployProfileOnRun();
  testSessionSnapshotWritesRunArtifact();
  testSessionStartWritesReadmeAndCanSkipBuildDeploy();
  testSessionRecordAppendsEventAndUpdatesReadme();
  testSessionRecordCanParsePytestLog();
  testSessionRecordCanParseFailedPytestLog();
  testSessionRecordCanParseRemotePytestLog();
  testSyncApplyCanAutoRecordToSessionRun();
  testEnvRefreshCanAutoRecordToSessionRun();
  testEnvDoctorCanAutoRecordToSessionRun();
  testWorkspaceScaffoldCreatesCleanSkeleton();
  testWorkspaceOnboardingContextTrackContextAndHandoff();
  testKnowledgeListSearchLintAndCaptureRun();
  testSkillListLintAndInstallUsesExplicitTarget();
  testRemoteDevVllmProfileChecksSourceVenvAndImport();
  testRemoteDevProfileWithoutVllmSkipsImportCheck();
  testVllmRefreshCommandUsesEditablePrecompiledInstall();
  testEnvRefreshDefaultsToDryRunPlan();
  console.log('workspace-runtime: ok');
}

main();
