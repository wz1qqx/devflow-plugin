#!/usr/bin/env node
'use strict';

const { output, error } = require('./core.cjs');

const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];
const rest = args.slice(2);
const ERROR_PREFIX = '[devteam] ERROR:';
const USAGE_MESSAGE = 'Usage: node lib/devteam.cjs <command> [subcommand] [args...]\n\nPrimary commands:\n  workspace scaffold|onboard|context      Create .devteam skeleton and agent onboarding/context\n  track list|status|context|bind|use      Inspect or bind session-local workspace tracks\n  presence list|touch|clear               Session presence and soft-lock hints\n  session start|snapshot|record|status|handoff|list|lint|archive-plan|archive|supersede-plan|supersede-stale|close|supersede|reopen\n                                           Run session artifact creation, evidence, lifecycle, and handoff\n  status [args]                            Latest run status overview\n  doctor [agent-onboarding] [args]         Workspace/env/sync and onboarding checks\n  ws status|materialize|publish-plan|publish\n                                           Workspace inventory and publish planning\n  env doctor|list|refresh [args]           Environment profile checks and venv refresh\n  sync plan|apply|status [args]            Local-to-remote sync plan\n  remote-loop <subcommand>                 Track-scoped remote validation loop\n  image plan|prepare|record [args]         Image build plan, context preparation, and evidence\n  deploy plan|record|verify-record [args]  k8s deployment plan and preprod evidence\n  skill list|status|lint|install [args]    Codex skill discovery, validation, and installation\n  knowledge list|search|lint|capture       Workspace recipes/wiki/skills operations\n\nLegacy feature-pipeline commands remain loadable for migration/history but are not part of the primary workflow.';

try {
  if (!command) {
    error(USAGE_MESSAGE);
  }
  switch (command) {
    case 'init': {
      const { initWorkflow } = require('./init.cjs');
      initWorkflow(subcommand, rest).catch(err => {
        process.stderr.write(`${ERROR_PREFIX} ${err.message}\n`);
        process.exit(1);
      });
      return;
    }
    case 'config': {
      const { handleConfig } = require('./config.cjs');
      handleConfig(subcommand, rest);
      break;
    }
    case 'state': {
      const { handleState } = require('./state.cjs');
      handleState(subcommand, rest);
      break;
    }
    case 'pipeline': {
      const { handlePipelineState } = require('./pipeline-state.cjs');
      handlePipelineState(subcommand, rest);
      break;
    }
    case 'run': {
      const { handleRunState } = require('./run-state.cjs');
      handleRunState(subcommand, rest);
      break;
    }
    case 'tasks': {
      const { handleTaskState } = require('./task-state.cjs');
      handleTaskState(subcommand, rest);
      break;
    }
    case 'hooks': {
      const { handleHooks } = require('./hooks-runner.cjs');
      handleHooks(subcommand, rest);
      break;
    }
    case 'orchestration': {
      const { handleOrchestration } = require('./orchestration-kernel.cjs');
      handleOrchestration(subcommand, rest);
      break;
    }
    case 'checkpoint': {
      const { writeCheckpoint } = require('./checkpoint.cjs');
      writeCheckpoint(null, args.slice(1));
      break;
    }
    case 'workspace': {
      const { handleWorkspaceScaffold } = require('./workspace-scaffold.cjs');
      handleWorkspaceScaffold(subcommand, rest);
      break;
    }
    case 'lite': {
      const { handleLite } = require('./lite-migrate.cjs');
      handleLite(subcommand, rest);
      break;
    }
    case 'ws': {
      const { handleWorkspaceInventory } = require('./workspace-inventory.cjs');
      handleWorkspaceInventory(subcommand, rest);
      break;
    }
    case 'env': {
      const { handleEnvProfile } = require('./env-profile.cjs');
      handleEnvProfile(subcommand, rest);
      break;
    }
    case 'sync': {
      const { handleSyncPlan } = require('./sync-plan.cjs');
      handleSyncPlan(subcommand, rest);
      break;
    }
    case 'track': {
      const { handleTrack } = require('./track-profile.cjs');
      handleTrack(subcommand, rest);
      break;
    }
    case 'remote-loop': {
      const { handleRemoteLoop } = require('./remote-loop.cjs');
      handleRemoteLoop(subcommand, rest);
      break;
    }
    case 'doctor': {
      const { handleLiteDoctor } = require('./lite-doctor.cjs');
      handleLiteDoctor(args.slice(1));
      break;
    }
    case 'status': {
      const { handleStatusOverview } = require('./lite-session.cjs');
      handleStatusOverview(args.slice(1));
      break;
    }
    case 'image': {
      const { handleImagePlan } = require('./lite-action-plan.cjs');
      handleImagePlan(subcommand, rest);
      break;
    }
    case 'deploy': {
      const { handleDeployPlan } = require('./lite-action-plan.cjs');
      handleDeployPlan(subcommand, rest);
      break;
    }
    case 'session': {
      const { handleLiteSession } = require('./lite-session.cjs');
      handleLiteSession(subcommand, rest);
      break;
    }
    case 'presence': {
      const { handlePresence } = require('./presence.cjs');
      handlePresence(subcommand, rest);
      break;
    }
    case 'knowledge': {
      const { handleLiteKnowledge } = require('./lite-knowledge.cjs');
      handleLiteKnowledge(subcommand, rest);
      break;
    }
    case 'skill': {
      const { handleLiteSkill } = require('./lite-skill.cjs');
      handleLiteSkill(subcommand, rest);
      break;
    }
    case 'features': {
      const { loadConfig, listFeatures } = require('./config.cjs');
      const { deleteFeature } = require('./state.cjs');
      const config = loadConfig();

      if (!subcommand || subcommand === 'list') {
        const features = listFeatures(config);
        output({ features });
      } else if (subcommand === 'delete') {
        const name = rest[0];
        if (!name) {
          error('Usage: features delete <name>\n\nAvailable features: ' +
            Object.keys(config.features).join(', '));
        }
        const result = deleteFeature(config, name);
        output(result);
      } else {
        error(`Unknown features subcommand: ${subcommand}. Use: list, delete`);
      }
      break;
    }
    case 'build': {
      if (subcommand !== 'record') {
        error(`Unknown build subcommand: '${subcommand}'. Use: record`);
      }
      const { loadConfig: loadCfg, requireFeature, getWorkspaceRoot } = require('./config.cjs');
      const { appendBuildHistory, writeBuildManifest, updateFeatureField } = require('./state.cjs');
      const { readRunState } = require('./run-state.cjs');
      const { execFileSync } = require('child_process');
      const { computeReuseKey, lookupReuse, recordReuseEntry } = require('./build-index.cjs');
      const cfg = loadCfg();

      const parseFlag = (flag) => {
        const idx = rest.indexOf(flag);
        return idx !== -1 ? rest[idx + 1] : null;
      };

      const feature = requireFeature(cfg, parseFlag('--feature'));
      const featureName = feature.name;
      const tag     = parseFlag('--tag');
      const legacyBase = parseFlag('--base');
      const changes = parseFlag('--changes');
      const noReuse = rest.includes('--no-reuse');
      if (!tag || !changes) {
        error('Usage: build record --tag <tag> --changes "<summary>" [--feature <name>] [--base <legacy-parent>] [--parent-image <image>] [--fallback-base-image <image>] [--result-image <image>] [--mode fast|rust|full] [--cluster <name>] [--note "<note>"] [--no-reuse]');
      }

      const imageName = (feature.build && feature.build.image_name) || featureName;
      const registry = (cfg.build_server && cfg.build_server.registry) || null;
      const previousTag = feature.current_tag || null;
      const previousBuiltImage = previousTag && registry && imageName
        ? `${registry}/${imageName}:${previousTag}`
        : null;

      const fallbackBaseImage = parseFlag('--fallback-base-image') || feature.base_image || null;
      const parentImage = parseFlag('--parent-image')
        || (previousTag ? (previousBuiltImage || legacyBase || null) : (fallbackBaseImage || legacyBase || null));
      const resultingImage = parseFlag('--result-image')
        || (registry && imageName ? `${registry}/${imageName}:${tag}` : null);
      const buildMode = parseFlag('--mode') || null;

      const root = getWorkspaceRoot(cfg);
      // --run-path allows explicit override; defaults to the feature's own RUN.json.
      const runPathOverride = parseFlag('--run-path');
      let runState;
      if (runPathOverride) {
        try {
          runState = JSON.parse(require('fs').readFileSync(runPathOverride, 'utf8'));
        } catch (e) {
          error(`Failed to read RUN.json from --run-path '${runPathOverride}': ${e.message}`);
        }
      } else {
        runState = readRunState(root, featureName);
      }
      const sourceRefs = runState && Array.isArray(runState.repos)
        ? runState.repos
          .filter(repo => repo && repo.repo)
          .map(repo => ({
            repo: repo.repo,
            start_head: repo.start_head || null,
            start_branch: repo.start_branch || null,
            dev_worktree: repo.dev_worktree || null,
          }))
        : [];
      const sourceRepos = sourceRefs.map(ref => ref.repo);
      const reuseInputs = {
        source_refs: sourceRefs.map(ref => ({
          repo: ref.repo || '',
          start_head: ref.start_head || '',
        })),
        build_mode: buildMode || '',
        parent_image: parentImage || '',
      };
      let reuseKey = null;
      let reused = false;
      let reusedFrom = null;
      let resolvedTag = tag;
      let resolvedResultImage = resultingImage;

      const verifyReusedImage = (imageRef) => {
        if (!imageRef) return false;
        try {
          execFileSync('docker', ['manifest', 'inspect', imageRef], {
            stdio: ['ignore', 'ignore', 'ignore'],
          });
          return true;
        } catch (_) {
          return false;
        }
      };

      if (sourceRefs.length > 0) {
        reuseKey = computeReuseKey(sourceRefs, buildMode, parentImage);
        if (!noReuse) {
          const reuseHit = lookupReuse(root, reuseKey).entry;
          if (
            reuseHit &&
            reuseHit.result &&
            verifyReusedImage(reuseHit.result.resulting_image || null)
          ) {
            reused = true;
            resolvedTag = reuseHit.result.resulting_tag || reuseHit.result.tag || tag;
            resolvedResultImage = reuseHit.result.resulting_image || resultingImage;
            reusedFrom = {
              feature: reuseHit.result.feature || null,
              tag: reuseHit.result.resulting_tag || reuseHit.result.tag || null,
            };
          }
        }
      }

      const userNote = parseFlag('--note') || null;
      const reuseNote = reused
        ? `reused from ${(reusedFrom && reusedFrom.feature) || 'unknown-feature'}@${(reusedFrom && reusedFrom.tag) || 'unknown-tag'}`
        : null;
      const mergedNote = [userNote, reuseNote].filter(Boolean).join('; ') || null;

      const entry = {
        tag: resolvedTag,
        date:    parseFlag('--date') || new Date().toISOString().slice(0, 10),
        changes,
        base: parentImage,
        parent_image: parentImage,
        fallback_base_image: fallbackBaseImage,
        resulting_tag: resolvedTag,
        resulting_image: resolvedResultImage,
        run_id: runState && runState.run_id ? runState.run_id : null,
        source_refs: sourceRefs,
        source_repos: sourceRepos,
        mode: buildMode,
        cluster: parseFlag('--cluster') || null,
        note: mergedNote,
        reused,
      };

      // 1. Update current_tag (scalar — existing function handles it)
      updateFeatureField(cfg, featureName, 'current_tag', resolvedTag);

      // 2. Append to build_history list (reload config after current_tag write)
      const cfg2 = loadCfg();
      appendBuildHistory(cfg2, featureName, entry);

      // 3. Write permanent build-manifest.md
      const manifestPath = writeBuildManifest(root, featureName, entry);

      if (!reused && reuseKey) {
        recordReuseEntry(root, reuseKey, reuseInputs, {
          resulting_image: resolvedResultImage,
          resulting_tag: resolvedTag,
          run_id: entry.run_id,
          feature: featureName,
          recorded_at: entry.date,
        });
      }

      output({
        feature: featureName,
        tag: resolvedTag,
        date: entry.date,
        parent_image: entry.parent_image,
        fallback_base_image: entry.fallback_base_image,
        resulting_image: entry.resulting_image,
        run_id: entry.run_id,
        source_refs: entry.source_refs,
        reused,
        reuse_key: reuseKey,
        manifest: manifestPath,
      });
      break;
    }
    case 'stage-result': {
      const { handleStageResult } = require('./stage-result.cjs');
      handleStageResult(subcommand, rest);
      break;
    }
    default:
      error(`Unknown command: ${command}`);
  }
} catch (err) {
  const message = err.message;
  process.stderr.write(`${ERROR_PREFIX} ${message}\n`);
  process.exit(1);
}
