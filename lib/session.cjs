'use strict';

const fs = require('fs');
const path = require('path');
const { error, findWorkspaceRoot } = require('./core.cjs');

const FEATURE_CONTEXT_HEADERS = {
  decisions: [
    '| ID | Decision | Rationale | Date |',
    '|----|----------|-----------|------|',
  ],
  activeBlockers: [
    '| ID | Blocker | Type | Workaround |',
    '|----|---------|------|------------|',
  ],
  archivedBlockers: [
    '| ID | Blocker | Type | Resolved | Resolution |',
    '|----|---------|------|----------|------------|',
  ],
};

/**
 * Parse STATE.md frontmatter and body sections.
 * Returns { frontmatter, decisions, blockers, position, raw } or null.
 * @param {string} root - Workspace root
 * @param {string} [featureName] - If provided, look in .dev/features/<feature>/STATE.md first
 */
function loadStateMd(root, featureName) {
  const rootDir = root || findWorkspaceRoot();
  if (!rootDir) return null;

  // Try per-feature path first, fall back to global
  let statePath;
  if (featureName) {
    const featurePath = path.join(rootDir, '.dev', 'features', featureName, 'STATE.md');
    if (fs.existsSync(featurePath)) {
      statePath = featurePath;
    }
  }
  if (!statePath) {
    statePath = path.join(rootDir, '.dev', 'STATE.md');
  }
  if (!fs.existsSync(statePath)) return null;

  const content = fs.readFileSync(statePath, 'utf8');
  const result = { frontmatter: {}, decisions: [], blockers: [], position: {}, raw: content };

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    for (const line of fmMatch[1].split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).trim().replace(/^"(.*)"$/, '$1');
        result.frontmatter[key] = val;
      }
    }
  }

  const decisionsMatch = content.match(/## Decisions\n\|[^\n]+\n\|[-| ]+\n([\s\S]*?)(?=\n## |\n$|$)/);
  if (decisionsMatch) {
    for (const row of decisionsMatch[1].trim().split('\n').filter(r => r.startsWith('|'))) {
      const cells = row.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 5) {
        result.decisions.push({
          id: cells[0], decision: cells[1], rationale: cells[2], date: cells[3], feature: cells[4],
        });
      }
    }
  }

  const blockersMatch = content.match(/## Blockers\n\|[^\n]+\n\|[-| ]+\n([\s\S]*?)(?=\n## |\n$|$)/);
  if (blockersMatch) {
    for (const row of blockersMatch[1].trim().split('\n').filter(r => r.startsWith('|'))) {
      const cells = row.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 5) {
        result.blockers.push({
          id: cells[0], blocker: cells[1], type: cells[2], status: cells[3], workaround: cells[4],
        });
      }
    }
  }

  const posMatch = content.match(/## Position\n([\s\S]*?)(?=\n## |\n$|$)/);
  if (posMatch) {
    const posText = posMatch[1].trim();
    const currentMatch = posText.match(/Currently working on:\s*(.*)/);
    const nextMatch = posText.match(/Next step:\s*(.*)/);
    if (currentMatch) result.position.current = currentMatch[1].trim();
    if (nextMatch) result.position.next = nextMatch[1].trim();
  }

  return result;
}

function loadFeatureContext(root, featureName) {
  const rootDir = root || findWorkspaceRoot();
  if (!rootDir || !featureName) return null;

  const contextPath = getFeatureContextPath(rootDir, featureName);
  if (!fs.existsSync(contextPath)) return null;

  const content = fs.readFileSync(contextPath, 'utf8');
  const result = {
    frontmatter: parseFrontmatter(content),
    decisions: parseTableSection(content, '## Decisions', cells => ({
      id: cells[0],
      decision: cells[1],
      rationale: cells[2],
      date: cells[3],
    }), 4),
    blockers: parseTableSection(content, '## Active Blockers', cells => ({
      id: cells[0],
      blocker: cells[1],
      type: cells[2],
      workaround: cells[3],
      status: 'active',
    }), 4),
    archived_blockers: parseTableSection(content, '## Archived Blockers', cells => ({
      id: cells[0],
      blocker: cells[1],
      type: cells[2],
      resolved: cells[3],
      resolution: cells[4],
      status: 'resolved',
    }), 5),
    raw: content,
    path: contextPath,
  };

  return result;
}

/**
 * Update fields in STATE.md frontmatter and/or position section.
 * @param {string} root - Workspace root
 * @param {object} updates - Fields to update
 * @param {string} [featureName] - If provided, write to .dev/features/<feature>/STATE.md
 */
function updateStateMd(root, updates, featureName) {
  const rootDir = root || findWorkspaceRoot();
  if (!rootDir) error('workspace.yaml not found');

  let statePath;
  if (featureName) {
    const featureDir = path.join(rootDir, '.dev', 'features', featureName);
    if (!fs.existsSync(featureDir)) fs.mkdirSync(featureDir, { recursive: true });
    statePath = path.join(featureDir, 'STATE.md');
  } else {
    statePath = path.join(rootDir, '.dev', 'STATE.md');
  }

  let content;
  if (fs.existsSync(statePath)) {
    content = fs.readFileSync(statePath, 'utf8');
  } else {
    const templatePath = path.join(__dirname, '..', 'templates', 'STATE.md');
    if (fs.existsSync(templatePath)) {
      content = fs.readFileSync(templatePath, 'utf8');
    } else {
      content = '---\nproject: unknown\nphase: init\ncurrent_feature: null\nfeature_stage: null\nplan_progress: "0/0"\nlast_activity: "' + new Date().toISOString() + '"\npipeline_stages: ""\ncompleted_stages: ""\npipeline_loop_count: "0"\n---\n\n## Position\nCurrently working on: N/A\nNext step: N/A\n\n## Decisions\n| ID | Decision | Rationale | Date | Feature |\n|----|----------|-----------|------|---------|\n\n## Blockers\n| ID | Blocker | Type | Status | Workaround |\n|----|---------|------|--------|------------|\n\n## Metrics\n| Feature | Spec | Plan | Exec | Review | Duration |\n|---------|------|------|------|--------|----------|\n';
    }
    const devDir = path.join(rootDir, '.dev');
    if (!fs.existsSync(devDir)) fs.mkdirSync(devDir, { recursive: true });
  }

  if (updates.frontmatter) {
    for (const [key, value] of Object.entries(updates.frontmatter)) {
      const regex = new RegExp(`^(${key}:\\s*).*$`, 'm');
      const quoted = formatFrontmatterValue(value);
      if (regex.test(content)) {
        content = content.replace(regex, `$1${quoted}`);
      } else {
        // Append new key before closing --- (match the second ---, not the first)
        const fmEnd = content.indexOf('\n---', content.indexOf('---') + 3);
        if (fmEnd !== -1) {
          content = content.slice(0, fmEnd) + `\n${key}: ${quoted}` + content.slice(fmEnd);
        }
      }
    }
  }

  if (updates.position) {
    if (updates.position.current) {
      content = content.replace(/Currently working on:\s*.*/, `Currently working on: ${updates.position.current}`);
    }
    if (updates.position.next) {
      content = content.replace(/Next step:\s*.*/, `Next step: ${updates.position.next}`);
    }
  }

  fs.writeFileSync(statePath, content, 'utf8');
  return { path: statePath, updated: true };
}

function formatFrontmatterValue(value) {
  if (value === '') return '""';
  if (typeof value === 'string' && value.includes(':')) return `"${value}"`;
  return value;
}

function parseFrontmatter(content) {
  const frontmatter = {};
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return frontmatter;

  for (const line of fmMatch[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim().replace(/^"(.*)"$/, '$1');
      frontmatter[key] = val;
    }
  }
  return frontmatter;
}

function parseTableSection(content, sectionHeader, mapper, minCells) {
  const pattern = new RegExp(`${escapeRegExp(sectionHeader)}\\n\\|[^\\n]+\\n\\|[-| ]+\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = content.match(pattern);
  if (!match) return [];

  return match[1]
    .trim()
    .split('\n')
    .filter(row => row.startsWith('|'))
    .map(row => row.split('|').map(c => c.trim()).filter(c => c))
    .filter(cells => cells.length >= minCells)
    .map(mapper);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getFeatureContextPath(rootDir, featureName) {
  return path.join(rootDir, '.dev', 'features', featureName, 'context.md');
}

function ensureFeatureContext(rootDir, featureName) {
  const contextPath = getFeatureContextPath(rootDir, featureName);
  if (fs.existsSync(contextPath)) return contextPath;

  const featureDir = path.dirname(contextPath);
  fs.mkdirSync(featureDir, { recursive: true });

  const templatePath = path.join(__dirname, '..', 'templates', 'context.md');
  const template = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, 'utf8')
    : [
        '---',
        'feature: {{feature}}',
        'last_updated: {{timestamp}}',
        '---',
        '',
        '## Decisions',
        ...FEATURE_CONTEXT_HEADERS.decisions,
        '',
        '## Active Blockers',
        ...FEATURE_CONTEXT_HEADERS.activeBlockers,
        '',
        '## Archived Blockers',
        ...FEATURE_CONTEXT_HEADERS.archivedBlockers,
        '',
      ].join('\n');

  const content = template
    .replace(/\{\{feature\}\}/g, featureName)
    .replace(/\{\{timestamp\}\}/g, new Date().toISOString());
  fs.writeFileSync(contextPath, content, 'utf8');
  return contextPath;
}

function updateFrontmatter(content, updates) {
  let next = content;
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^(${key}:\\s*).*$`, 'm');
    const quoted = formatFrontmatterValue(value);
    if (regex.test(next)) {
      next = next.replace(regex, `$1${quoted}`);
    } else {
      const fmEnd = next.indexOf('\n---', next.indexOf('---') + 3);
      if (fmEnd !== -1) {
        next = next.slice(0, fmEnd) + `\n${key}: ${quoted}` + next.slice(fmEnd);
      }
    }
  }
  return next;
}

function replaceTableSection(content, sectionHeader, headerLines, rows) {
  const block = [
    sectionHeader,
    ...headerLines,
    ...rows,
  ].join('\n') + '\n';
  const pattern = new RegExp(`${escapeRegExp(sectionHeader)}\\n\\|[^\\n]+\\n\\|[-| ]+\\n([\\s\\S]*?)(?=\\n## |$)`);
  if (pattern.test(content)) {
    return content.replace(pattern, block);
  }
  return content.trimEnd() + '\n\n' + block + '\n';
}

function writeFeatureContext(rootDir, featureName, contextData) {
  const contextPath = ensureFeatureContext(rootDir, featureName);
  let content = fs.readFileSync(contextPath, 'utf8');

  content = updateFrontmatter(content, {
    feature: featureName,
    last_updated: new Date().toISOString(),
  });
  content = replaceTableSection(
    content,
    '## Decisions',
    FEATURE_CONTEXT_HEADERS.decisions,
    (contextData.decisions || []).map(decision => `| ${decision.id} | ${decision.decision} | ${decision.rationale} | ${decision.date} |`)
  );
  content = replaceTableSection(
    content,
    '## Active Blockers',
    FEATURE_CONTEXT_HEADERS.activeBlockers,
    (contextData.blockers || []).map(blocker => `| ${blocker.id} | ${blocker.blocker} | ${blocker.type} | ${blocker.workaround} |`)
  );
  content = replaceTableSection(
    content,
    '## Archived Blockers',
    FEATURE_CONTEXT_HEADERS.archivedBlockers,
    (contextData.archived_blockers || []).map(blocker => `| ${blocker.id} | ${blocker.blocker} | ${blocker.type} | ${blocker.resolved} | ${blocker.resolution} |`)
  );

  fs.writeFileSync(contextPath, content.trimEnd() + '\n', 'utf8');
  return contextPath;
}

function resolveFeatureName(rootDir, featureName, fallbackFeature) {
  return featureName || fallbackFeature || null;
}

function findFeatureByActiveBlockerId(rootDir, blockerId) {
  const featuresDir = path.join(rootDir, '.dev', 'features');
  if (!fs.existsSync(featuresDir)) return null;

  for (const name of fs.readdirSync(featuresDir)) {
    const context = loadFeatureContext(rootDir, name);
    if (context && context.blockers.some(blocker => blocker.id === blockerId)) {
      return name;
    }
  }
  return null;
}

function appendTableRow(statePath, sectionHeader, row) {
  let content = fs.readFileSync(statePath, 'utf8');
  const pattern = new RegExp(`${sectionHeader}\\n\\|[^\\n]+\\n\\|[-| ]+\\n([\\s\\S]*?)(?=\\n## |$)`);
  const insertPoint = content.match(pattern);
  if (insertPoint) {
    const matchEnd = content.indexOf(insertPoint[0]) + insertPoint[0].length;
    const nextSection = content.indexOf('\n## ', matchEnd);
    if (nextSection !== -1) {
      const beforeNext = content.lastIndexOf('\n', nextSection);
      content = content.slice(0, beforeNext) + '\n' + row + content.slice(beforeNext);
    } else {
      // Section is at end of file — append row before trailing whitespace
      const trimmed = content.trimEnd();
      content = trimmed + '\n' + row + '\n';
    }
  }
  fs.writeFileSync(statePath, content, 'utf8');
}

function addDecision(root, decision) {
  const rootDir = root || findWorkspaceRoot();
  if (!rootDir) error('workspace.yaml not found');
  const featureName = resolveFeatureName(rootDir, decision.feature, decision.feature_name);
  if (!featureName) error('Decision feature is required');

  const context = loadFeatureContext(rootDir, featureName) || { decisions: [], blockers: [], archived_blockers: [] };
  context.decisions.push({
    id: decision.id,
    decision: decision.decision,
    rationale: decision.rationale,
    date: decision.date,
  });
  const contextPath = writeFeatureContext(rootDir, featureName, context);
  return { feature: featureName, path: contextPath, added: decision.id };
}

function addBlocker(root, blocker) {
  const rootDir = root || findWorkspaceRoot();
  if (!rootDir) error('workspace.yaml not found');
  const featureName = resolveFeatureName(rootDir, blocker.feature, blocker.feature_name);
  if (!featureName) error('Blocker feature is required');

  const context = loadFeatureContext(rootDir, featureName) || { decisions: [], blockers: [], archived_blockers: [] };
  context.blockers.push({
    id: blocker.id,
    blocker: blocker.blocker,
    type: blocker.type,
    workaround: blocker.workaround,
    status: 'active',
  });
  const contextPath = writeFeatureContext(rootDir, featureName, context);
  return { feature: featureName, path: contextPath, added: blocker.id };
}

function resolveBlocker(root, blockerId, featureName, resolutionNote = 'resolved') {
  const rootDir = root || findWorkspaceRoot();
  if (!rootDir) error('workspace.yaml not found');
  const resolvedFeature = featureName || findFeatureByActiveBlockerId(rootDir, blockerId);
  if (!resolvedFeature) return { resolved: false, reason: `Blocker ${blockerId} not found or feature not provided` };

  const context = loadFeatureContext(rootDir, resolvedFeature);
  if (!context) return { resolved: false, reason: 'context.md not found' };

  const blockerIndex = context.blockers.findIndex(blocker => blocker.id === blockerId);
  if (blockerIndex === -1) {
    return { resolved: false, reason: `Blocker ${blockerId} not found or not active` };
  }

  const [blocker] = context.blockers.splice(blockerIndex, 1);
  context.archived_blockers.push({
    id: blocker.id,
    blocker: blocker.blocker,
    type: blocker.type,
    resolved: new Date().toISOString().slice(0, 10),
    resolution: resolutionNote,
    status: 'resolved',
  });
  const contextPath = writeFeatureContext(rootDir, resolvedFeature, context);
  return { resolved: true, id: blockerId, feature: resolvedFeature, path: contextPath };
}

/**
 * @param {string} root
 * @param {object} data
 * @param {string} [featureName] - If provided, write to per-feature dir
 */
function writeHandoff(root, data, featureName) {
  const rootDir = root || findWorkspaceRoot();
  if (!rootDir) error('workspace.yaml not found');

  let targetDir;
  if (featureName) {
    targetDir = path.join(rootDir, '.dev', 'features', featureName);
  } else {
    targetDir = path.join(rootDir, '.dev');
  }
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const handoffPath = path.join(targetDir, 'HANDOFF.json');
  const payload = { version: '1.0', timestamp: new Date().toISOString(), ...data };
  fs.writeFileSync(handoffPath, JSON.stringify(payload, null, 2), 'utf8');
  return { path: handoffPath, written: true };
}

/**
 * @param {string} root
 * @param {string} [featureName] - If provided, read from per-feature dir first
 */
function readHandoff(root, featureName) {
  const rootDir = root || findWorkspaceRoot();
  if (!rootDir) return null;

  // Try per-feature path first, fall back to global
  if (featureName) {
    const featurePath = path.join(rootDir, '.dev', 'features', featureName, 'HANDOFF.json');
    if (fs.existsSync(featurePath)) {
      try { return JSON.parse(fs.readFileSync(featurePath, 'utf8')); } catch (_) { /* fall through */ }
    }
  }
  const handoffPath = path.join(rootDir, '.dev', 'HANDOFF.json');
  if (!fs.existsSync(handoffPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(handoffPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} root
 * @param {string} [featureName] - If provided, delete from per-feature dir
 */
function deleteHandoff(root, featureName) {
  const rootDir = root || findWorkspaceRoot();
  if (!rootDir) return false;

  if (featureName) {
    const featurePath = path.join(rootDir, '.dev', 'features', featureName, 'HANDOFF.json');
    if (fs.existsSync(featurePath)) { fs.unlinkSync(featurePath); return true; }
  }
  const handoffPath = path.join(rootDir, '.dev', 'HANDOFF.json');
  if (fs.existsSync(handoffPath)) {
    fs.unlinkSync(handoffPath);
    return true;
  }
  return false;
}

module.exports = {
  loadStateMd, loadFeatureContext, updateStateMd,
  addDecision, addBlocker, resolveBlocker,
  writeHandoff, readHandoff, deleteHandoff,
};
