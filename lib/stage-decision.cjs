'use strict';

const { error, output, parseArgs } = require('./core.cjs');
const { readStageResultInput, parseStageResultMessage } = require('./stage-result.cjs');

function parseInteger(value, flag) {
  if (value == null || value === '') return null;
  const normalized = String(value);
  if (!/^\d+$/.test(normalized)) {
    error(`Invalid ${flag} '${value}'. Expected a non-negative integer.`);
  }
  return Number(normalized);
}

function extractRegressions(stageResult) {
  if (
    stageResult &&
    stageResult.metrics &&
    Array.isArray(stageResult.metrics.regressions)
  ) {
    return stageResult.metrics.regressions;
  }
  return [];
}

function extractRemediationItems(stageResult) {
  if (stageResult && Array.isArray(stageResult.remediation_items)) {
    return stageResult.remediation_items;
  }
  return [];
}

function buildNeedsInputPrompt(stageResult, fallback) {
  if (stageResult && typeof stageResult.blocking_reason === 'string' && stageResult.blocking_reason.trim()) {
    return stageResult.blocking_reason.trim();
  }
  if (stageResult && typeof stageResult.next_action === 'string' && stageResult.next_action.trim()) {
    return stageResult.next_action.trim();
  }
  return fallback;
}

function normalizedDecision(stageResult, overrides) {
  const remediationItems = extractRemediationItems(stageResult);
  const regressions = extractRegressions(stageResult);

  return {
    stage: stageResult.stage,
    decision: overrides.decision,
    reason: overrides.reason || '',
    needs_user_input: overrides.needs_user_input === true,
    retryable: overrides.retryable === true,
    next_action: stageResult.next_action || null,
    user_prompt: overrides.user_prompt || null,
    loop_context: overrides.loop_context || null,
    remediation_items: overrides.remediation_items || remediationItems,
    regressions: overrides.regressions || regressions,
    should_accept: overrides.should_accept === true,
    should_checkpoint: overrides.should_checkpoint === true,
    review_cycle: overrides.review_cycle == null ? null : overrides.review_cycle,
    max_review_cycles: overrides.max_review_cycles == null ? null : overrides.max_review_cycles,
    remaining_review_cycles: overrides.remaining_review_cycles == null
      ? null
      : overrides.remaining_review_cycles,
  };
}

function decideStageResult(stageResult, options = {}) {
  const reviewCycle = options.reviewCycle == null ? 0 : options.reviewCycle;
  const maxReviewCycles = options.maxReviewCycles == null ? 2 : options.maxReviewCycles;
  const optimizationEnabled = options.optimizationEnabled !== false;

  if (stageResult.status === 'needs_input' || stageResult.verdict === 'NEEDS_INPUT') {
    return normalizedDecision(stageResult, {
      decision: 'needs_input',
      reason: 'Stage explicitly requires user input.',
      needs_user_input: true,
      retryable: Boolean(stageResult.retryable),
      user_prompt: buildNeedsInputPrompt(
        stageResult,
        'The stage requested user guidance before it can continue.'
      ),
    });
  }

  if (stageResult.status === 'failed') {
    const retryable = Boolean(stageResult.retryable);
    return normalizedDecision(stageResult, {
      decision: retryable ? 'retry' : 'needs_input',
      reason: retryable
        ? 'Stage execution failed but marked retryable.'
        : 'Stage execution failed and requires user guidance.',
      needs_user_input: !retryable,
      retryable,
      user_prompt: retryable
        ? null
        : buildNeedsInputPrompt(
          stageResult,
          'Execution failed and is not retryable. Ask the user how to proceed.'
        ),
    });
  }

  if (stageResult.status !== 'completed') {
    error(`Unsupported stage-result status '${stageResult.status}'.`);
  }

  if (stageResult.verdict === 'PASS' || stageResult.verdict === 'PASS_WITH_WARNINGS') {
    return normalizedDecision(stageResult, {
      decision: 'accept',
      reason: 'Stage completed successfully.',
      should_accept: true,
      should_checkpoint: true,
      retryable: Boolean(stageResult.retryable),
    });
  }

  if (stageResult.verdict !== 'FAIL') {
    error(`Unsupported stage-result verdict '${stageResult.verdict}'.`);
  }

  if (stageResult.stage === 'review') {
    const remainingReviewCycles = Math.max(0, maxReviewCycles - reviewCycle);
    const withinLoopBudget = reviewCycle < maxReviewCycles;
    return normalizedDecision(stageResult, {
      decision: withinLoopBudget ? 'review_fix_loop' : 'needs_input',
      reason: withinLoopBudget
        ? 'Reviewer found blocking issues and review loop budget remains.'
        : 'Reviewer found blocking issues and review loop budget is exhausted.',
      needs_user_input: !withinLoopBudget,
      user_prompt: withinLoopBudget
        ? null
        : buildNeedsInputPrompt(
          stageResult,
          'Review loop budget is exhausted. Ask the user whether to continue or stop.'
        ),
      remediation_items: extractRemediationItems(stageResult),
      loop_context: {
        kind: 'review',
        review_cycle: reviewCycle,
        max_review_cycles: maxReviewCycles,
        remaining_review_cycles: remainingReviewCycles,
        within_loop_budget: withinLoopBudget,
      },
      review_cycle: reviewCycle,
      max_review_cycles: maxReviewCycles,
      remaining_review_cycles: remainingReviewCycles,
    });
  }

  if (stageResult.stage === 'verify') {
    return normalizedDecision(stageResult, {
      decision: optimizationEnabled ? 'optimization_loop' : 'needs_input',
      reason: optimizationEnabled
        ? 'Verification failed after execution and should enter the optimization loop.'
        : 'Verification failed but optimization loop is disabled.',
      needs_user_input: !optimizationEnabled,
      user_prompt: optimizationEnabled
        ? null
        : buildNeedsInputPrompt(
          stageResult,
          'Optimization loop is disabled. Ask the user whether to retry, optimize, or stop.'
        ),
      regressions: extractRegressions(stageResult),
      loop_context: {
        kind: 'optimization',
        optimization_enabled: optimizationEnabled,
      },
    });
  }

  return normalizedDecision(stageResult, {
    decision: 'needs_input',
    reason: `Stage '${stageResult.stage}' returned FAIL and requires orchestrator judgment.`,
    needs_user_input: true,
    retryable: Boolean(stageResult.retryable),
    user_prompt: buildNeedsInputPrompt(
      stageResult,
      `Stage '${stageResult.stage}' failed with verdict FAIL. Ask the user how to proceed.`
    ),
  });
}

function handleStageDecision(args) {
  const parsedArgs = parseArgs(args || []);
  const inputPath = parsedArgs._[0] || null;
  const message = readStageResultInput(inputPath);
  const parsedMessage = parseStageResultMessage(message, {
    expectedStage: parsedArgs.stage || null,
  });

  const decision = decideStageResult(parsedMessage.result, {
    reviewCycle: parseInteger(parsedArgs['review-cycle'], '--review-cycle'),
    maxReviewCycles: parseInteger(parsedArgs['max-review-cycles'], '--max-review-cycles'),
    optimizationEnabled: parsedArgs['disable-optimization-loop'] ? false : true,
  });

  output({
    report: parsedMessage.report,
    result: parsedMessage.result,
    decision,
  });
}

module.exports = {
  decideStageResult,
  handleStageDecision,
};
