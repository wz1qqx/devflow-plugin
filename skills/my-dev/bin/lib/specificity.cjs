'use strict';

/**
 * Specificity detector for devflow commands.
 * Determines if a user's prompt is specific enough for direct execution,
 * or too vague and should be routed to planning/discuss first.
 *
 * Inspired by OMC's ralplan gate mechanism.
 */

const WELL_SPECIFIED_SIGNALS = [
  /\b[\w/.-]+\.(?:ts|js|py|yaml|yml|md|go|rs|toml|json|sh|cjs)\b/,  // file path with extension
  /\b(?:src|lib|test|cmd|pkg|internal|bin|hooks|workflows|agents)\/\w+/,  // directory path
  /\b\d+\.\d+\.\d+\.\d+\b/,        // IP address
  /\b[\w.-]+:[\w.-]+\b/,            // Docker tag (image:tag)
  /(?:^|\s)#\d+\b/,                 // Issue/PR number
  /\b[a-z]+(?:[A-Z][a-z]+)+\b/,     // camelCase symbol
  /\b[a-z]+(?:_[a-z]+){2,}\b/,      // snake_case (at least 2 underscores to avoid false positives)
  /(?:^|\n)\s*(?:\d+[.)]\s|-\s+\S)/m,  // numbered steps or bullet list
  /```[\s\S]{20,}?```/,             // code block (>20 chars)
  /\b(?:kubectl|docker|ssh|git|npm|node)\s+\w+/i,  // CLI command
  /\b(?:pod|deployment|service|configmap|secret|namespace)\s+[\w-]+/i,  // K8s resource name
  /--[\w-]+=[\w.-]+/,               // CLI flag with value
  // Devflow-specific signals
  /\b(?:feature|cluster|tag)\s+[\w-]+/i,  // devflow entity references
  /\b[\w]+-[\w]+-[\w]+-v\d+\b/,     // multi-segment tags (e.g., kimi-pd-pegaflow-v2)
  /\b(?:worktree|base_ref|dev_worktree)\b/i,  // devflow config terms
];

const FORCE_BYPASS = /^(?:force|!)\s*:/i;

function checkSpecificity(prompt) {
  if (!prompt || !prompt.trim()) {
    return { specific: false, reason: 'empty_prompt', suggestion: 'discuss' };
  }

  const trimmed = prompt.trim();

  // Force bypass
  if (FORCE_BYPASS.test(trimmed)) {
    return { specific: true, reason: 'force_bypass' };
  }

  // Check for well-specified signals
  const matchedSignals = WELL_SPECIFIED_SIGNALS
    .filter(r => r.test(trimmed))
    .map((_, i) => i);

  if (matchedSignals.length > 0) {
    return { specific: true, reason: 'has_signals', signal_count: matchedSignals.length };
  }

  // Check effective word count (CJK-aware)
  const { countEffectiveWords } = require('./core.cjs');
  const effectiveWords = countEffectiveWords(trimmed);

  if (effectiveWords <= 10) {
    return { specific: false, reason: 'too_short', effective_words: effectiveWords, suggestion: 'discuss' };
  }

  if (effectiveWords <= 20) {
    return { specific: false, reason: 'likely_vague', effective_words: effectiveWords, suggestion: 'spec' };
  }

  // Longer prompts without specific signals — borderline, let through with note
  return { specific: true, reason: 'sufficient_length', effective_words: effectiveWords };
}

module.exports = { checkSpecificity };
