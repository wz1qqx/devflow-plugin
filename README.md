# devteam

[![v2.1.0](https://img.shields.io/badge/version-2.1.0-orange)](https://github.com/wz1qqx/devteam)

`devteam` is a lightweight workspace control layer for multi-repo development.
It helps an agent or human session understand the current workspace, choose a
track, sync local worktree changes to a remote development host, record remote
venv validation, plan image builds, and capture pre-production deployment
evidence.

The current architecture is centered on `.devteam/config.yaml`. Reusable
capabilities such as `vllm-opt` live on as independent skills instead of being
mixed into workspace recipes.

## Daily Model

The normal workflow is:

1. Open a devteam-managed workspace.
2. Ask for workspace context or the devteam console.
3. Choose a track for the current session.
4. Start or continue a run for that track.
5. Inspect local worktrees and sync code changes to the remote dev host.
6. Validate in the configured remote venv and record test evidence.
7. Review image build plans and record completed image evidence.
8. Review deployment plans and record pre-production verification evidence.
9. Publish validated branches when the run gate is ready.

Tracks are session-scoped. `defaults.workspace_set` in `.devteam/config.yaml` is
only a default hint; it must not be treated as a global active track when
multiple sessions may be open.

## Core Concepts

- **Workspace**: a directory containing `.devteam/config.yaml`.
- **Track**: one development lane, usually a named bundle of worktrees, env
  profile, sync profile, image profile, and deploy profile.
- **Run**: an auditable directory under `.devteam/runs/<run-id>/` containing
  session metadata, evidence events, and a generated README.
- **Presence**: lightweight soft-lock hints under `.devteam/presence/` for
  concurrent sessions. Presence never blocks work by itself.
- **Evidence**: recorded facts such as sync, env-doctor, env-refresh, test,
  image-build, deploy, deploy-verify, and publish.
- **Skill**: reusable Codex skill folders managed separately from wiki/recipe
  knowledge.

## Agent Entry Points

For a compact agent-facing workspace context:

```bash
node lib/devteam.cjs workspace context --root "$PWD" --for codex --text
```

For the track picker:

```bash
node lib/devteam.cjs track list --root "$PWD" --active-only --text
```

For selected-track context:

```bash
node lib/devteam.cjs track context --root "$PWD" --set "<track>" --text
```

For a one-screen status view:

```bash
node lib/devteam.cjs status --root "$PWD" --set "<track>"
```

For a session handoff before a context switch:

```bash
node lib/devteam.cjs session handoff --root "$PWD" --set "<track>" --text
```

## Onboarding Files

Generate project-local agent instructions for any devteam workspace:

```bash
node lib/devteam.cjs workspace onboard --root "$PWD" --write --text
```

Check that the onboarding files and skills are ready:

```bash
node lib/devteam.cjs doctor agent-onboarding --root "$PWD" --text
```

Generated files:

- `AGENTS.md`
- `CLAUDE.md`
- `README.devteam.md`

These files are derived from `templates/onboarding/` and should teach
Claude/Codex how to work in the workspace without relying on repository-specific
memory.

## Primary CLI Surface

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

Command metadata lives in `commands/devteam/_registry.yaml`. Generated command
docs live in `commands/devteam/*.md`.

## Repository Map

- `lib/devteam.cjs`: CLI router.
- `lib/workspace-scaffold.cjs`: `.devteam` workspace skeleton creation.
- `lib/workspace-onboarding.cjs`: generated agent onboarding and dynamic context.
- `lib/track-profile.cjs`: track listing, context, aliases, and session binding.
- `lib/session-manager.cjs`: run sessions, evidence, gates, lifecycle cleanup, and handoff.
- `lib/presence.cjs`: concurrent session presence hints.
- `lib/workspace-inventory.cjs`: local worktree status and publish planning.
- `lib/env-profile.cjs`: remote/k8s environment profile doctor and refresh.
- `lib/sync-plan.cjs`: local-to-remote sync planning and execution.
- `lib/action-plan.cjs`: image/deploy planning and evidence gates.
- `lib/skill-manager.cjs`: skill discovery, lint, and installation.
- `lib/knowledge-manager.cjs`: lightweight recipes/wiki/skills knowledge layer.
- `skills/devteam-console`: one-shot workspace console skill.
- `skills/devteam-status`: compact workspace/run status skill.
- `templates/onboarding`: generated `AGENTS.md`, `CLAUDE.md`, and `README.devteam.md`.
- `tests/workspace-runtime.test.cjs`: current broad regression suite for the
  lightweight workspace model.

## Validation

Useful checks while changing devteam:

```bash
node tests/workspace-runtime.test.cjs
node tests/command-generation.test.cjs
node tests/release-hygiene.test.cjs
node lib/devteam.cjs skill lint --root <workspace-root> --text
node lib/devteam.cjs doctor agent-onboarding --root <workspace-root> --text
git diff --check
```

For application workspace changes, run the smallest meaningful validation for
the selected track first, then record the result as run evidence.
