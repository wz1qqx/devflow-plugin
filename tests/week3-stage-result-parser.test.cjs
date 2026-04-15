'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { parseStageResultMessage } = require('../lib/stage-result.cjs');

const CLI = path.resolve(__dirname, '..', 'lib', 'devteam.cjs');

function sampleMessage() {
  return [
    '# Code Review: feat-a',
    '',
    'Found one blocking issue.',
    '',
    '## STAGE_RESULT',
    '```json',
    JSON.stringify({
      stage: 'review',
      status: 'completed',
      verdict: 'FAIL',
      artifacts: [
        { kind: 'review', path: '.dev/features/feat-a/review.md' },
      ],
      next_action: 'Send remediation items back to the coder.',
      retryable: false,
      metrics: {
        finding_counts: {
          critical: 0,
          high: 1,
          medium: 0,
          low: 0,
          info: 0,
        },
      },
      remediation_items: [
        'Fix nil handling in request validation.',
      ],
    }, null, 2),
    '```',
    '',
  ].join('\n');
}

function testParsesReportAndStructuredResult() {
  const parsed = parseStageResultMessage(sampleMessage(), { expectedStage: 'review' });

  assert.match(parsed.report, /^# Code Review: feat-a/m);
  assert.strictEqual(parsed.result.stage, 'review');
  assert.strictEqual(parsed.result.status, 'completed');
  assert.strictEqual(parsed.result.verdict, 'FAIL');
  assert.deepStrictEqual(parsed.result.remediation_items, ['Fix nil handling in request validation.']);
}

function testRejectsTrailingProseAfterJsonBlock() {
  const invalid = sampleMessage() + '\nextra trailing prose';

  assert.throws(
    () => parseStageResultMessage(invalid, { expectedStage: 'review' }),
    /final content in the message/
  );
}

function testCliParsesFromStdinAndPersistsReport() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-stage-result-cli-'));
  const reportPath = path.join(tempDir, 'review.md');
  const stdout = execFileSync(
    'node',
    [CLI, 'stage-result', 'parse', '--stage', 'review', '--report-path', reportPath],
    {
      input: sampleMessage(),
      encoding: 'utf8',
    }
  );
  const parsed = JSON.parse(stdout);

  assert.strictEqual(parsed.result.stage, 'review');
  assert.strictEqual(parsed.report_path, reportPath);
  assert.match(parsed.report, /^# Code Review: feat-a/m);
  assert.strictEqual(fs.readFileSync(reportPath, 'utf8'), parsed.report);
}

function testCliRejectsStageMismatch() {
  const result = spawnSync(
    'node',
    [CLI, 'stage-result', 'parse', '--stage', 'build'],
    {
      input: sampleMessage(),
      encoding: 'utf8',
    }
  );

  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /expected 'build', got 'review'/);
}

function main() {
  testParsesReportAndStructuredResult();
  testRejectsTrailingProseAfterJsonBlock();
  testCliParsesFromStdinAndPersistsReport();
  testCliRejectsStageMismatch();
  console.log('week3-stage-result-parser: ok');
}

main();
