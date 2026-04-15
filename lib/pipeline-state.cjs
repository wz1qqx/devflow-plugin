'use strict';

const { output, error, parseArgs, findWorkspaceRoot } = require('./core.cjs');
const { loadConfig, getActiveFeature } = require('./config.cjs');
const { loadStateMd, updateStateMd } = require('./session.cjs');
const { updatePhase } = require('./state.cjs');
const { writeCheckpoint } = require('./checkpoint.cjs');

const VALID_PIPELINE_STAGES = new Set(['spec', 'plan', 'code', 'review', 'build', 'ship', 'verify']);

function resolveWorkspaceRoot(rootArg) {
  const root = rootArg ? findWorkspaceRoot(rootArg) : findWorkspaceRoot();
  if (!root) error('workspace.yaml not found');
  return root;
}

function resolveFeatureName(root, featureArg) {
  const config = loadConfig(root);
  const feature = getActiveFeature(config, featureArg);
  if (!feature || !feature.name) {
    error('No feature specified and no active_feature configured. Use --feature <name>.');
  }
  return { config, featureName: feature.name };
}

function normalizeStages(stageCsv) {
  if (!stageCsv) error('--stages is required');
  const stages = String(stageCsv)
    .split(',')
    .map(stage => stage.trim())
    .filter(Boolean);

  if (stages.length === 0) error('--stages must include at least one stage');
  for (const stage of stages) {
    if (!VALID_PIPELINE_STAGES.has(stage)) {
      error(`Invalid pipeline stage '${stage}'. Valid: ${Array.from(VALID_PIPELINE_STAGES).join(', ')}`);
    }
  }
  return stages.join(',');
}

function writePipelineState(root, featureName, frontmatter) {
  return updateStateMd(root, {
    frontmatter: {
      ...frontmatter,
      last_activity: new Date().toISOString(),
    },
  }, featureName);
}

function initPipeline(root, featureName, stages) {
  const normalizedStages = normalizeStages(stages);
  const state = writePipelineState(root, featureName, {
    pipeline_stages: normalizedStages,
    completed_stages: '',
    pipeline_loop_count: '0',
  });

  return {
    action: 'init',
    feature: featureName,
    pipeline_stages: normalizedStages,
    completed_stages: '',
    pipeline_loop_count: '0',
    state,
  };
}

function updateLoopCount(root, featureName, count) {
  if (count == null || count === '') error('--count is required');
  const normalizedCount = String(count);
  if (!/^\d+$/.test(normalizedCount)) {
    error(`Invalid loop count '${count}'. Expected a non-negative integer.`);
  }

  const state = writePipelineState(root, featureName, {
    pipeline_loop_count: normalizedCount,
  });

  return {
    action: 'loop',
    feature: featureName,
    pipeline_loop_count: normalizedCount,
    state,
  };
}

function resetPipeline(root, featureName, options = {}) {
  const frontmatter = {
    completed_stages: '',
    pipeline_loop_count: '0',
    feature_stage: '',
  };
  if (options.clearStages) {
    frontmatter.pipeline_stages = '';
  }

  const state = writePipelineState(root, featureName, frontmatter);
  return {
    action: 'reset',
    feature: featureName,
    completed_stages: '',
    pipeline_loop_count: '0',
    feature_stage: '',
    pipeline_stages: options.clearStages ? '' : undefined,
    state,
  };
}

function completePipeline(root, config, featureName, options = {}) {
  const stateMd = loadStateMd(root, featureName);
  const completedStages = options.stages
    ? normalizeStages(options.stages)
    : ((stateMd && stateMd.frontmatter && (stateMd.frontmatter.pipeline_stages || stateMd.frontmatter.completed_stages)) || '');

  if (!completedStages) {
    error('Cannot complete pipeline without known stages. Pass --stages or initialize pipeline_stages first.');
  }

  const state = writePipelineState(root, featureName, {
    completed_stages: completedStages,
    feature_stage: 'completed',
  });
  const phase = updatePhase(config, featureName, 'completed');
  const checkpoint = writeCheckpoint(
    null,
    [
      '--action', options.action || 'team-complete',
      '--summary', options.summary || `Pipeline complete for ${featureName}`,
      '--feature', featureName,
    ],
    { root, silent: true }
  );

  return {
    action: 'complete',
    feature: featureName,
    completed_stages: completedStages,
    feature_stage: 'completed',
    phase,
    state,
    checkpoint,
  };
}

function handlePipelineState(subcommand, args) {
  const parsed = parseArgs(args || []);
  const root = resolveWorkspaceRoot(parsed.root || null);
  const { config, featureName } = resolveFeatureName(root, parsed.feature || null);

  let result;
  switch (subcommand) {
    case 'init':
      result = initPipeline(root, featureName, parsed.stages);
      break;
    case 'loop':
      result = updateLoopCount(root, featureName, parsed.count);
      break;
    case 'reset':
      result = resetPipeline(root, featureName, {
        clearStages: Boolean(parsed['clear-stages']),
      });
      break;
    case 'complete':
      result = completePipeline(root, config, featureName, {
        stages: parsed.stages || null,
        summary: parsed.summary || null,
        action: parsed.action || null,
      });
      break;
    default:
      error(`Unknown pipeline subcommand: '${subcommand}'. Use: init, loop, reset, complete`);
  }

  output(result);
}

module.exports = {
  VALID_PIPELINE_STAGES,
  normalizeStages,
  initPipeline,
  updateLoopCount,
  resetPipeline,
  completePipeline,
  handlePipelineState,
};
