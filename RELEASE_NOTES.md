# devteam Release Notes

## 2.1.0 - .devteam workspace runtime

This release resets devteam around the current workspace model:
local Mac worktrees, session-selected tracks, remote venv validation, image
planning, pre-production deploy evidence, and reusable skills.

The active runtime is `.devteam/config.yaml`. The previous feature pipeline
runtime has been removed from the CLI and generated command surface.

### Current Workflow

1. Open a devteam-managed workspace.
2. Read workspace context and choose a track for the current session.
3. Start or continue a run under `.devteam/runs/<run-id>/`.
4. Inspect worktrees and sync selected changes to the remote test host.
5. Validate in the configured remote venv and record evidence.
6. Review image plans, prepare build contexts when useful, and record image
   build evidence.
7. Review deploy plans and record deploy plus post-deploy verification evidence.
8. Publish validated branches only after the run gate is ready.

### Runtime Surface

Primary CLI commands:

- `workspace scaffold|onboard|context`
- `track list|status|context|bind|use`
- `presence list|touch|clear`
- `session start|snapshot|record|status|handoff|list|lint|archive-plan|archive|supersede-plan|supersede-stale|close|supersede|reopen`
- `status`
- `doctor [agent-onboarding]`
- `ws status|materialize|publish-plan|publish`
- `env list|doctor|refresh`
- `sync plan|apply|status`
- `remote-loop plan|start|doctor|refresh|sync|record-test|status`
- `image plan|prepare|record`
- `deploy plan|record|verify-record`
- `skill list|status|lint|install`
- `knowledge list|search|lint|capture`

The router no longer exposes feature-pipeline commands such as `init`,
`config`, `state`, `pipeline`, `run`, `tasks`, `hooks`, `orchestration`,
`checkpoint`, `build record`, or `stage-result`.

### Workspace And Track Model

- Tracks are session-scoped. `defaults.workspace_set` is only a default hint.
- Use `--set <track>` or `DEVTEAM_TRACK` for the current session.
- `track list --active-only --text` is the default picker surface for agents.
- `presence` records soft-lock hints for concurrent sessions; it never blocks
  sync, test, build, publish, or deploy.
- `session handoff --text` provides an agent continuation packet before a
  context switch.

### Remote Validation

- `env doctor` inspects local profile fields and optional read-only remote checks.
- `env refresh` plans or executes editable vLLM remote venv refreshes.
- `sync plan/apply` supports normal rsync and relative patch sync strategies.
- `remote-loop` wraps the common source-to-remote-venv loop while leaving the
  exact test command flexible per change.
- Test evidence is recorded from explicit summaries or pytest logs rather than
  predefined test profiles.

### Image And Deploy Flow

Image profiles are contracts first:

- `tag_patch_image`: start from a pinned vLLM tag image and overlay safe source
  changes for fast iteration.
- `full_source_image`: build from source worktrees when the base is not a known
  tag or the patch is not safe for overlay.

`image prepare` materializes a local `.devteam/image-contexts` build context but
does not run Docker or push images. `image record` stores build evidence in the
run.

Deploy profiles describe pre-production targets. `deploy record` and
`deploy verify-record` are separate so deployment and validation evidence stay
auditable.

### Skills

Reusable skills are managed separately from recipes and wiki notes.

Included skills:

- `devteam-console`: one-screen daily workspace console.
- `devteam-status`: compact workspace/run status summary.
- `vllm-opt`: independent vLLM benchmark, profiler, and kernel-category
  optimization workflow.

Use `skill status --root <workspace> --text` to check whether installed skill
copies are current, missing, drifted, or invalid.

### Agent Onboarding

`workspace onboard --write` generates:

- `AGENTS.md`
- `CLAUDE.md`
- `README.devteam.md`

`doctor agent-onboarding --text` verifies that those files point agents to
workspace context, track selection, and the current skill entry points.

### Cleanup In This Release

- Removed feature-pipeline runtime modules and tests.
- Removed old prompt assets and generated command exposure for the previous
  pipeline surface.
- Renamed workspace runtime modules to current responsibility names:
  - `workspace-config.cjs`
  - `session-manager.cjs`
  - `action-plan.cjs`
  - `workspace-doctor.cjs`
  - `skill-manager.cjs`
  - `knowledge-manager.cjs`
- Replaced migration-era naming in tests and docs.
- Preserved reusable optimization knowledge as the independent `vllm-opt` skill.

### Validation

Release checks:

```bash
node tests/week4-command-generation.test.cjs
node tests/week4-release-hygiene.test.cjs
node tests/week4-hooks.test.cjs
node tests/week4-statusline.test.cjs
node tests/week5-version.test.cjs
node tests/week15-workspace.test.cjs
node lib/devteam.cjs skill lint --root <workspace-root> --text
node lib/devteam.cjs doctor agent-onboarding --root <workspace-root> --text
node lib/devteam.cjs skill status --root <workspace-root> --text
git diff --check
```

## Deferred Work

- Knowledge/wiki import and capture flows still need a focused redesign.
- Hook behavior should be reviewed against long-running multi-session work.
- Build profiles should continue to be validated against real vLLM tag-patch and
  full-source image builds.
- Deploy verification should accumulate concrete recipes per cluster or target.
