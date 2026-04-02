'use strict';

/**
 * Task complexity classifier.
 * Determines pipeline depth based on prompt signals.
 *
 * Tiers:
 *   quick  → exec → commit                    (typo, config, version bump)
 *   small  → plan → exec → review             (1-3 files, <100 lines)
 *   medium → spec → plan → exec → review      (cross-file, standard feature)
 *   large  → discuss → spec → plan → exec → review  (cross-repo, architecture)
 */

const LARGE_SIGNALS = [
  /\brefactor\b/i,
  /\barchitect(ure)?\b/i,
  /\bmigrat(e|ion)\b/i,
  /\bredesign\b/i,
  /\bentire\s+(codebase|project|system)\b/i,
  /across\s+.*repos?\b/i,
  /\bcross[- ]repo\b/i,
  /\bbreaking\s+change/i,
  /\bapi\s+(redesign|overhaul|rewrite)\b/i,
];

const SMALL_SIGNALS = [
  /\btypo\b/i,
  /\bsingle\s+file\b/i,
  /\bminor\s+(fix|change|update|tweak)\b/i,
  /\bbump\s+version\b/i,
  /\bconfig\s+(change|update)\b/i,
  /\bremove\s+unused\b/i,
  /\b(add|update)\s+comment/i,
  /\brename\b/i,
  /\bformat(ting)?\b/i,
];

const QUICK_PREFIXES = /^(quick|just|simply|typo|fix typo|bump)[\s:]/i;
const LARGE_PREFIXES = /^(large|architect|redesign|refactor all)[\s:]/i;

const PIPELINE_MAP = {
  quick: ['exec'],
  small: ['plan', 'exec', 'review'],
  medium: ['spec', 'plan', 'exec', 'review'],
  large: ['discuss', 'spec', 'plan', 'exec', 'review'],
};

function classifyTaskSize(prompt) {
  if (!prompt || !prompt.trim()) {
    return { size: 'medium', reason: 'empty_prompt', pipeline: PIPELINE_MAP.medium };
  }

  const trimmed = prompt.trim();

  // Escape hatch: explicit prefix overrides
  if (QUICK_PREFIXES.test(trimmed)) {
    return { size: 'quick', reason: 'escape_hatch', pipeline: PIPELINE_MAP.quick };
  }
  if (LARGE_PREFIXES.test(trimmed)) {
    return { size: 'large', reason: 'escape_hatch', pipeline: PIPELINE_MAP.large };
  }

  const wordCount = trimmed.split(/\s+/).length;
  const hasLargeSignal = LARGE_SIGNALS.some(r => r.test(trimmed));
  const hasSmallSignal = SMALL_SIGNALS.some(r => r.test(trimmed));

  // Large: explicit signals or very long prompt
  if (hasLargeSignal || wordCount > 150) {
    return { size: 'large', reason: hasLargeSignal ? 'signal_match' : 'long_prompt', pipeline: PIPELINE_MAP.large };
  }

  // Quick: short prompt + no large signals
  if (wordCount <= 20 && !hasLargeSignal) {
    if (hasSmallSignal) {
      return { size: 'quick', reason: 'short_with_small_signal', pipeline: PIPELINE_MAP.quick };
    }
    return { size: 'small', reason: 'short_prompt', pipeline: PIPELINE_MAP.small };
  }

  // Small: small signals + moderate length
  if (hasSmallSignal && wordCount <= 50) {
    return { size: 'small', reason: 'signal_match', pipeline: PIPELINE_MAP.small };
  }

  // Default: medium
  return { size: 'medium', reason: 'default', pipeline: PIPELINE_MAP.medium };
}

module.exports = { classifyTaskSize, PIPELINE_MAP };
