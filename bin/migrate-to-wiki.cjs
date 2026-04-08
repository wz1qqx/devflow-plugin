#!/usr/bin/env node
/**
 * migrate-to-wiki.cjs
 *
 * Unify all group wiki directories into a single vault-level wiki/.
 *
 * Usage: node bin/migrate-to-wiki.cjs --unify <vault-path>
 *
 * What it does:
 * 1. Scans all {group}/wiki/ directories in the vault
 * 2. Copies all pages to $VAULT/wiki/ (flat, single directory)
 * 3. Handles filename conflicts (renames with group prefix)
 * 4. Cleans old dual-layer artifacts (deep/ links, nav lines)
 * 5. Generates unified index.md and log.md
 * 6. Does NOT delete old {group}/wiki/ directories
 */

const fs = require('fs');
const path = require('path');

function main() {
  const args = process.argv.slice(2);
  const unify = args.includes('--unify');
  const vaultArg = args.find(a => !a.startsWith('--'));

  if (!vaultArg) {
    console.error('Usage: node bin/migrate-to-wiki.cjs --unify <vault-path>');
    process.exit(1);
  }

  const vault = path.resolve(vaultArg.replace(/^~/, process.env.HOME));
  if (!fs.existsSync(vault)) {
    console.error(`Vault not found: ${vault}`);
    process.exit(1);
  }

  if (!unify) {
    console.error('This script now requires --unify flag for vault-level wiki migration.');
    process.exit(1);
  }

  unifyWiki(vault);
}

function unifyWiki(vault) {
  const wikiDir = path.join(vault, 'wiki');
  const today = new Date().toISOString().slice(0, 10);

  // Discover groups: directories that contain a wiki/ subdirectory
  const entries = fs.readdirSync(vault, { withFileTypes: true });
  const groups = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'wiki')
    .map(e => e.name)
    .filter(name => {
      const groupWiki = path.join(vault, name, 'wiki');
      const groupKnowledge = path.join(vault, name, 'knowledge');
      return fs.existsSync(groupWiki) || fs.existsSync(groupKnowledge);
    });

  if (groups.length === 0) {
    console.log('No groups with wiki/ or knowledge/ directories found.');
    process.exit(0);
  }

  // Check if vault-level wiki/ already has content
  if (fs.existsSync(wikiDir)) {
    const existing = fs.readdirSync(wikiDir)
      .filter(f => f.endsWith('.md') && !['index.md', 'log.md', '_schema.md'].includes(f));
    if (existing.length > 0) {
      console.error(`$VAULT/wiki/ already has ${existing.length} pages. Aborting to avoid duplicates.`);
      console.error('Delete or rename $VAULT/wiki/ first if you want to re-run.');
      process.exit(1);
    }
  }

  fs.mkdirSync(wikiDir, { recursive: true });

  console.log(`\nUnifying ${groups.length} groups: ${groups.join(', ')}\n`);

  // Phase 1: Collect all pages from all groups
  const allPages = []; // [{file, group, srcPath, content}]
  const filenameCounts = new Map(); // filename -> count (for conflict detection)

  for (const group of groups) {
    const groupWikiDir = path.join(vault, group, 'wiki');
    const groupKnowledgeDir = path.join(vault, group, 'knowledge');

    // Prefer wiki/ if it exists, otherwise fall back to knowledge/
    const srcDir = fs.existsSync(groupWikiDir) ? groupWikiDir : groupKnowledgeDir;
    if (!fs.existsSync(srcDir)) continue;

    const files = fs.readdirSync(srcDir)
      .filter(f => f.endsWith('.md') && !f.startsWith('_') && !f.includes('.excalidraw')
        && f !== 'index.md' && f !== 'log.md');

    for (const file of files) {
      const srcPath = path.join(srcDir, file);
      const content = fs.readFileSync(srcPath, 'utf8');
      allPages.push({ file, group, srcPath, content });
      filenameCounts.set(file, (filenameCounts.get(file) || 0) + 1);
    }
  }

  console.log(`Found ${allPages.length} pages across ${groups.length} groups`);

  // Phase 2: Resolve filename conflicts
  const conflicts = [...filenameCounts.entries()].filter(([, count]) => count > 1);
  if (conflicts.length > 0) {
    console.log(`\nFilename conflicts found:`);
    for (const [file, count] of conflicts) {
      const owners = allPages.filter(p => p.file === file).map(p => p.group);
      console.log(`  ${file} -- in ${owners.join(', ')}`);
    }
  }

  // Phase 3: Write pages to unified wiki/
  const indexEntries = new Map(); // category -> [{name, summary}]
  let pageCount = 0;
  const written = new Set(); // track final filenames

  for (const page of allPages) {
    let destFile = page.file;

    // Handle conflicts: prefix with group name for duplicates
    if (filenameCounts.get(page.file) > 1) {
      const base = page.file.replace(/\.md$/, '');
      destFile = `${base}-${page.group}.md`;
      console.log(`  [RENAME] ${page.group}/${page.file} → ${destFile}`);
    }

    // Parse frontmatter and body
    const fmMatch = page.content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    let frontmatter = '';
    let body = page.content;
    if (fmMatch) {
      frontmatter = fmMatch[1];
      body = fmMatch[2];
    }

    // Update frontmatter
    const newFm = updateFrontmatter(frontmatter, today, page.group);

    // Clean old artifacts from body
    const cleanBody = cleanOldArtifacts(body);

    // Write to unified wiki
    const destPath = path.join(wikiDir, destFile);
    fs.writeFileSync(destPath, `---\n${newFm}\n---\n${cleanBody}`, 'utf8');
    pageCount++;

    // Collect index entry
    const pageName = destFile.replace(/\.md$/, '');
    written.add(pageName);
    const summary = extractSummary(cleanBody);
    const category = inferCategory(frontmatter, cleanBody, destFile, page.group);

    if (!indexEntries.has(category)) indexEntries.set(category, []);
    indexEntries.get(category).push({ name: pageName, summary, group: page.group });
  }

  // Phase 4: Generate unified index.md
  const indexContent = buildIndexMd(indexEntries);
  fs.writeFileSync(path.join(wikiDir, 'index.md'), indexContent, 'utf8');

  // Phase 5: Generate unified log.md
  const logLines = ['# Wiki Log', ''];
  logLines.push(`## ${today}`);
  logLines.push(`- **unify** ${pageCount} pages merged from ${groups.length} groups (${groups.join(', ')}) into vault-level wiki/`);
  // Merge existing group log entries
  for (const group of groups) {
    const groupLog = path.join(vault, group, 'wiki', 'log.md');
    if (fs.existsSync(groupLog)) {
      const logContent = fs.readFileSync(groupLog, 'utf8');
      const entries = logContent.match(/^- \*\*.+$/gm);
      if (entries) {
        for (const entry of entries) {
          logLines.push(`${entry} [${group}]`);
        }
      }
    }
  }
  logLines.push('');
  fs.writeFileSync(path.join(wikiDir, 'log.md'), logLines.join('\n'), 'utf8');

  // Summary
  console.log(`\n=== Unification Complete ===`);
  console.log(`  Pages: ${pageCount}`);
  console.log(`  Conflicts resolved: ${conflicts.length}`);
  console.log(`  Index categories: ${indexEntries.size}`);
  console.log(`  Output: ${wikiDir}`);
  console.log(`\nOld {group}/wiki/ directories preserved (not deleted).`);
  console.log('');
}

function updateFrontmatter(fm, today, group) {
  const lines = fm.split('\n');
  const result = [];
  let hasUpdated = false;
  let hasProject = false;

  for (const line of lines) {
    // Remove old dual-layer fields
    if (line.startsWith('parent:') || line.startsWith('type: deep-dive') || line.startsWith('style:')) continue;
    if (line.startsWith('confidence:')) continue;
    if (line.startsWith('level:')) continue;

    if (line.startsWith('updated:')) {
      result.push(`updated: ${today}`);
      hasUpdated = true;
      continue;
    }
    if (line.startsWith('project:')) {
      hasProject = true;
    }
    result.push(line);
  }

  // Ensure updated field exists
  if (!hasUpdated) {
    const dateIdx = result.findIndex(l => l.startsWith('date:'));
    if (dateIdx >= 0) {
      result.splice(dateIdx + 1, 0, `updated: ${today}`);
    } else {
      result.unshift(`date: ${today}`, `updated: ${today}`);
    }
  }

  // Ensure project field exists (preserves provenance)
  if (!hasProject && group) {
    const updatedIdx = result.findIndex(l => l.startsWith('updated:'));
    result.splice(updatedIdx + 1, 0, `project: ${group}`);
  }

  return result.join('\n');
}

function cleanOldArtifacts(body) {
  const lines = body.split('\n');
  const cleaned = [];

  for (const line of lines) {
    // Remove deep/ reverse links
    if (/^>\s*完整教学文章：\[\[deep\//.test(line.trim())) continue;
    if (/^>\s*AI 摘要版：\[\[knowledge\//.test(line.trim())) continue;
    // Remove old nav lines (> 返回 [[xxx]])
    if (/^>\s*返回\s+\[\[/.test(line.trim())) continue;
    // Remove > 返回 with multiple links on one line
    if (/^>\s*返回\s/.test(line.trim()) && line.includes('[[')) continue;

    cleaned.push(line);
  }

  // Remove leading blank lines after frontmatter
  while (cleaned.length > 0 && cleaned[0].trim() === '') {
    cleaned.shift();
  }

  return cleaned.join('\n');
}

function extractSummary(body) {
  // Try Key Insight section
  const kiMatch = body.match(/## Key Insight\s*\n([\s\S]*?)(?=\n## |\n---)/);
  if (kiMatch) {
    const text = kiMatch[1].trim().replace(/\n/g, ' ').replace(/\s+/g, ' ');
    if (text.length > 10) return text.slice(0, 120);
  }

  // Try ## 概述 section (Chinese overview)
  const overviewMatch = body.match(/## 概述\s*\n([\s\S]*?)(?=\n## |\n---)/);
  if (overviewMatch) {
    const text = overviewMatch[1].trim().replace(/\n/g, ' ').replace(/\s+/g, ' ')
      .replace(/^>\s*/, ''); // Strip blockquote marker
    if (text.length > 10 && !text.startsWith('```') && !text.startsWith('|')) {
      return text.slice(0, 120);
    }
  }

  // Try first heading content
  const h1Match = body.match(/^# .+\n\n([\s\S]*?)(?=\n## |\n---)/m);
  if (h1Match) {
    const text = h1Match[1].trim().replace(/\n/g, ' ').replace(/\s+/g, ' ');
    if (text.length > 10 && !text.startsWith('```') && !text.startsWith('|') && !text.startsWith('![[')) {
      return text.slice(0, 120);
    }
  }

  // Fallback: first meaningful prose line
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('>') || t.startsWith('```')
      || t.startsWith('|') || t.startsWith('![[') || t === '---') continue;
    if (t.startsWith('- **') || t.startsWith('**')) {
      return t.replace(/\*\*/g, '').slice(0, 120);
    }
    if (t.length > 20) return t.slice(0, 120);
  }

  return 'No summary available';
}

function inferCategory(frontmatter, body, filename, group) {
  const fm = frontmatter.toLowerCase();
  const name = filename.toLowerCase();

  // NIXL / KV transfer
  if (name.includes('nixl') || name.includes('kv-connector') || name.includes('kv-offload')
    || name.includes('lmcache') || name.includes('pega-connector')) {
    return 'KV Cache & Transfer';
  }
  if (name.includes('kv-event') || name.includes('event-plane') || name.includes('kvbm')
    || name.includes('radix-tree') || name.includes('kv-router')) {
    return 'KV Cache & Transfer';
  }

  // Routing & Scheduling
  if (name.includes('router') || name.includes('scheduler') || name.includes('scheduling')
    || name.includes('frontend') || name.includes('epp') || name.includes('gateway')) {
    return 'Routing & Scheduling';
  }

  // MoE & Expert Parallelism
  if (name.includes('moe') || name.includes('dbo') || name.includes('deepep')
    || name.includes('wide-ep') || name.includes('all2all')) {
    return 'MoE & Expert Parallelism';
  }

  // RDMA / Networking
  if (name.includes('rdma') || name.includes('roce') || name.includes('nccl')
    || name.includes('ibgda') || name.includes('perf-testing')) {
    return 'Networking & RDMA';
  }

  // Build & Deploy
  if (name.includes('build') || name.includes('docker') || name.includes('deploy')
    || name.includes('k8s') || name.includes('install') || name.includes('cluster')
    || name.includes('prereq') || name.includes('image') || name.includes('setup')
    || name.includes('onboarding')) {
    return 'Build & Deploy';
  }

  // Speculative Decoding / Compilation
  if (name.includes('mtp') || name.includes('cudagraph') || name.includes('pass-config')) {
    return 'Speculative Decoding & Compilation';
  }

  // Debug & Troubleshooting
  if (name.includes('debug') || name.includes('troubleshoot') || name.includes('diag')
    || name.includes('playbook')) {
    return 'Debug & Troubleshooting';
  }

  // Architecture overview
  if (name.includes('overview') || name.includes('architecture') || name.includes('pipeline')
    || name.includes('initflow') || name.includes('flow-example') || name.includes('production')
    || name.includes('disaggregation') || name.includes('observability')) {
    return 'Architecture & Overview';
  }

  // PegaFlow
  if (name.includes('pega') || name.includes('decode-l2')) {
    return 'KV Cache & Transfer';
  }

  return 'General';
}

function buildIndexMd(indexEntries) {
  const lines = ['# Wiki Index', ''];

  const categoryOrder = [
    'Architecture & Overview',
    'Routing & Scheduling',
    'KV Cache & Transfer',
    'MoE & Expert Parallelism',
    'Speculative Decoding & Compilation',
    'Networking & RDMA',
    'Build & Deploy',
    'Debug & Troubleshooting',
    'General',
  ];

  const sortedCategories = [...indexEntries.keys()].sort((a, b) => {
    const ai = categoryOrder.indexOf(a);
    const bi = categoryOrder.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  for (const category of sortedCategories) {
    const entries = indexEntries.get(category);
    lines.push(`## ${category}`);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`- [[${entry.name}]] -- ${entry.summary}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

main();
