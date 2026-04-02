'use strict';

const fs = require('fs');
const path = require('path');
const { output, error, findWorkspaceRoot } = require('./core.cjs');

/**
 * Discover agents from plugin and project directories.
 * Project-local agents (.devflow/agents/) override plugin agents with the same name.
 *
 * Agent .md files must have YAML frontmatter with at least: name, description
 */
function discoverAgents(pluginAgentsDir, projectAgentsDir) {
  const agents = {};

  // 1. Scan plugin agents/ directory
  scanAgentDir(pluginAgentsDir, 'plugin', agents);

  // 2. Scan project-local .devflow/agents/ (higher priority)
  if (projectAgentsDir && fs.existsSync(projectAgentsDir)) {
    scanAgentDir(projectAgentsDir, 'project', agents);
  }

  return agents;
}

function scanAgentDir(dir, source, agents) {
  if (!dir || !fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const filePath = path.join(dir, file);
    const meta = parseAgentFrontmatter(filePath);
    if (meta) {
      agents[meta.name] = { ...meta, source, path: filePath };
    }
  }
}

function parseAgentFrontmatter(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;

    const fm = fmMatch[1];
    const name = extractYamlField(fm, 'name');
    const description = extractYamlField(fm, 'description');
    const model = extractYamlField(fm, 'model');
    const tools = extractYamlList(fm, 'tools');

    if (!name) return null;

    return {
      name,
      description: description || '',
      model: model || null,
      tools: tools || [],
    };
  } catch (_) {
    return null;
  }
}

function extractYamlField(yaml, field) {
  const match = yaml.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
}

function extractYamlList(yaml, field) {
  const lines = yaml.split('\n');
  const idx = lines.findIndex(l => l.match(new RegExp(`^${field}:`)));
  if (idx === -1) return null;

  const items = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const itemMatch = lines[i].match(/^\s+-\s+(.+)/);
    if (itemMatch) {
      items.push(itemMatch[1].trim());
    } else if (!lines[i].match(/^\s*$/)) {
      break;
    }
  }
  return items.length > 0 ? items : null;
}

/**
 * Resolve the plugin agents directory.
 * Uses __dirname to find the agents/ sibling of bin/
 */
function getPluginAgentsDir() {
  return path.resolve(__dirname, '..', '..', 'agents');
}

/**
 * Resolve the project-local agents directory.
 * Looks for .devflow/agents/ in the workspace root.
 */
function getProjectAgentsDir() {
  const root = findWorkspaceRoot();
  if (!root) return null;
  const dir = path.join(root, '.devflow', 'agents');
  return fs.existsSync(dir) ? dir : null;
}

function handleAgents(subcommand) {
  const pluginDir = getPluginAgentsDir();
  const projectDir = getProjectAgentsDir();

  if (!subcommand || subcommand === 'list') {
    const agents = discoverAgents(pluginDir, projectDir);
    output({
      agents,
      count: Object.keys(agents).length,
      plugin_dir: pluginDir,
      project_dir: projectDir,
    });
  } else {
    error(`Unknown agents subcommand: ${subcommand}. Use: list`);
  }
}

module.exports = { discoverAgents, getPluginAgentsDir, getProjectAgentsDir, handleAgents };
