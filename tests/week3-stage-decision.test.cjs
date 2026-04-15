'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');
const { decideStageResult } = require('../lib/stage-decision.cjs');

const CLI = path.resolve(__dirname, '..', 'lib', 'devteam.cjs');

function messageFor(result) {
  return [
    `# ${result.stage} report`,
    '',
    'Human-readable report body.',
    '',
    '## STAGE_RESULT',
    '```json',
    JSON.stringify(result, null, 2),
    '```',
    '',
  ].join('\n');
}

function assertNormalizedDecisionShape(decision) {
  const expectedKeys = [
    'stage',
    'decision',
    'reason',
    'needs_user_input',
    'retryable',
    'next_action',
    'user_prompt',
    'loop_context',
    'remediation_items',
    'regressions',
    'should_accept',
    'should_checkpoint',
    'review_cycle',
    'max_review_cycles',
    'remaining_review_cycles',
  ];
  for (const key of expectedKeys) {
    assert.ok(Object.prototype.hasOwnProperty.call(decision, key), `missing decision key: ${key}`);
  }
  assert.ok(Array.isArray(decision.remediation_items), 'remediation_items must be an array');
  assert.ok(Array.isArray(decision.regressions), 'regressions must be an array');
}

function testPassMapsToAccept() {
  const decision = decideStageResult({
    stage: 'build',
    status: 'completed',
    verdict: 'PASS',
    artifacts: [],
    next_action: 'Ship the image.',
    retryable: false,
    metrics: {},
  });

  assertNormalizedDecisionShape(decision);
  assert.strictEqual(decision.decision, 'accept');
  assert.strictEqual(decision.should_accept, true);
  assert.strictEqual(decision.should_checkpoint, true);
  assert.strictEqual(decision.needs_user_input, false);
  assert.strictEqual(decision.user_prompt, null);
}

function testReviewFailWithinBudgetMapsToFixLoop() {
  const decision = decideStageResult({
    stage: 'review',
    status: 'completed',
    verdict: 'FAIL',
    artifacts: [],
    next_action: 'Send remediation items to coder.',
    retryable: false,
    metrics: {},
    remediation_items: ['Fix bug'],
  }, {
    reviewCycle: 1,
    maxReviewCycles: 2,
  });

  assertNormalizedDecisionShape(decision);
  assert.strictEqual(decision.decision, 'review_fix_loop');
  assert.strictEqual(decision.needs_user_input, false);
  assert.strictEqual(decision.remaining_review_cycles, 1);
  assert.deepStrictEqual(decision.remediation_items, ['Fix bug']);
  assert.deepStrictEqual(decision.loop_context, {
    kind: 'review',
    review_cycle: 1,
    max_review_cycles: 2,
    remaining_review_cycles: 1,
    within_loop_budget: true,
  });
}

function testReviewFailExhaustedBudgetNeedsInput() {
  const decision = decideStageResult({
    stage: 'review',
    status: 'completed',
    verdict: 'FAIL',
    artifacts: [],
    next_action: 'Ask the user how to proceed.',
    retryable: false,
    metrics: {},
  }, {
    reviewCycle: 2,
    maxReviewCycles: 2,
  });

  assertNormalizedDecisionShape(decision);
  assert.strictEqual(decision.decision, 'needs_input');
  assert.strictEqual(decision.needs_user_input, true);
  assert.ok(typeof decision.user_prompt === 'string' && decision.user_prompt.length > 0);
  assert.deepStrictEqual(decision.loop_context, {
    kind: 'review',
    review_cycle: 2,
    max_review_cycles: 2,
    remaining_review_cycles: 0,
    within_loop_budget: false,
  });
}

function testVerifyFailMapsToOptimizationLoop() {
  const decision = decideStageResult({
    stage: 'verify',
    status: 'completed',
    verdict: 'FAIL',
    artifacts: [],
    next_action: 'Feed regressions to vLLM-Opter.',
    retryable: false,
    metrics: {
      regressions: [{ metric: 'ttft_p50', delta_pct: 21 }],
    },
  });

  assertNormalizedDecisionShape(decision);
  assert.strictEqual(decision.decision, 'optimization_loop');
  assert.deepStrictEqual(decision.regressions, [{ metric: 'ttft_p50', delta_pct: 21 }]);
  assert.deepStrictEqual(decision.loop_context, {
    kind: 'optimization',
    optimization_enabled: true,
  });
}

function testFailedRetryableMapsToRetry() {
  const decision = decideStageResult({
    stage: 'ship',
    status: 'failed',
    verdict: 'FAIL',
    artifacts: [],
    next_action: 'Retry deployment after transient failure.',
    retryable: true,
    metrics: {},
  });

  assertNormalizedDecisionShape(decision);
  assert.strictEqual(decision.decision, 'retry');
  assert.strictEqual(decision.needs_user_input, false);
  assert.strictEqual(decision.user_prompt, null);
}

function testFailedNonRetryableMapsToNeedsInput() {
  const decision = decideStageResult({
    stage: 'ship',
    status: 'failed',
    verdict: 'FAIL',
    artifacts: [],
    next_action: 'Ask the user to inspect cluster credentials.',
    retryable: false,
    metrics: {},
  });

  assertNormalizedDecisionShape(decision);
  assert.strictEqual(decision.decision, 'needs_input');
  assert.strictEqual(decision.needs_user_input, true);
  assert.match(decision.user_prompt, /cluster credentials/i);
}

function testVerifyFailWithOptimizationDisabledNeedsInput() {
  const decision = decideStageResult({
    stage: 'verify',
    status: 'completed',
    verdict: 'FAIL',
    artifacts: [],
    next_action: 'Ask user whether to run optimization loop manually.',
    retryable: false,
    metrics: {
      regressions: [{ metric: 'throughput', delta_pct: -12 }],
    },
  }, {
    optimizationEnabled: false,
  });

  assertNormalizedDecisionShape(decision);
  assert.strictEqual(decision.decision, 'needs_input');
  assert.strictEqual(decision.needs_user_input, true);
  assert.match(decision.user_prompt, /optimization loop/i);
  assert.deepStrictEqual(decision.regressions, [{ metric: 'throughput', delta_pct: -12 }]);
}

function testStatusNeedsInputCarriesPrompt() {
  const decision = decideStageResult({
    stage: 'plan',
    status: 'needs_input',
    verdict: 'NEEDS_INPUT',
    artifacts: [],
    next_action: 'Need scope clarification from user.',
    retryable: false,
    metrics: {},
  });

  assertNormalizedDecisionShape(decision);
  assert.strictEqual(decision.decision, 'needs_input');
  assert.strictEqual(decision.needs_user_input, true);
  assert.match(decision.user_prompt, /scope clarification/i);
}

function testCliDecideReadsFromStdin() {
  const stdout = execFileSync(
    'node',
    [CLI, 'stage-result', 'decide', '--stage', 'review', '--review-cycle', '0', '--max-review-cycles', '2'],
    {
      input: messageFor({
        stage: 'review',
        status: 'completed',
        verdict: 'FAIL',
        artifacts: [],
        next_action: 'Send remediation items to coder.',
        retryable: false,
        metrics: {},
        remediation_items: ['Fix bug'],
      }),
      encoding: 'utf8',
    }
  );
  const parsed = JSON.parse(stdout);

  assert.strictEqual(parsed.result.stage, 'review');
  assert.strictEqual(parsed.decision.decision, 'review_fix_loop');
  assertNormalizedDecisionShape(parsed.decision);
}

function main() {
  testPassMapsToAccept();
  testReviewFailWithinBudgetMapsToFixLoop();
  testReviewFailExhaustedBudgetNeedsInput();
  testVerifyFailMapsToOptimizationLoop();
  testFailedRetryableMapsToRetry();
  testFailedNonRetryableMapsToNeedsInput();
  testVerifyFailWithOptimizationDisabledNeedsInput();
  testStatusNeedsInputCarriesPrompt();
  testCliDecideReadsFromStdin();
  console.log('week3-stage-decision: ok');
}

main();
