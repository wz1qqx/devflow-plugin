# Knowledge Conventions Reference

<purpose>Authoritative reference for the wiki-based knowledge system. All knowledge-related workflows (learn, knowledge) reference this document for file formats, writing guidelines, and organizational rules.</purpose>

## Wiki Architecture

```
{vault}/wiki/                  -- unified wiki (single directory, all projects)
  _schema.md                   -- wiki conventions (LLM reads this first)
  index.md                     -- content catalog: every page with link + summary
  log.md                       -- append-only chronological operations log
  {page-name}.md               -- entity/concept pages (tags identify source project)

{vault}/{group}/experience/    -- troubleshooting patterns, ops experience (per-project)
```

The wiki is **vault-level, not per-group**. All projects share one wiki. Pages from different projects (vllm, dynamo, llm-d) interlink freely via `[[wikilinks]]`. Source project is tracked in frontmatter `project:` field and tags.

**Vault-optional fallback**: If `vault` is not configured in `.dev.yaml`, wiki lives at `.dev/wiki/` with identical structure.

**Core idea**: The LLM incrementally builds and maintains a persistent wiki — a structured, interlinked collection of markdown files. When new code is researched, the LLM reads it, extracts key information, and integrates it into the existing wiki — updating entity pages, revising topic summaries, noting contradictions, strengthening the evolving synthesis. Knowledge is compiled once and kept current, not re-derived on every query.

## Three Operations

| Operation | Command | What it does |
|-----------|---------|--------------|
| **Ingest** | `/devflow:learn <topic>` | Research source code, create/update wiki pages, update index, append log |
| **Query** | `/devflow:knowledge search <query>` | Search wiki via index, synthesize answer, optionally file back as new page |
| **Lint** | `/devflow:knowledge lint` | Health-check: stale pages, orphans, dead links, missing cross-refs, over-long pages |

## Wiki Page Format

### Frontmatter

```yaml
---
date: YYYY-MM-DD
updated: YYYY-MM-DD
project: {group}
repo_commits:
  {repo}: "{commit_hash}"
tags: [topic1, topic2]
---
```

### Body

Free-form markdown with:
- `[[wikilinks]]` for cross-references to other wiki pages
- Source code citations with `file.py:line` format
- ASCII diagrams for architecture/data flow (encouraged)
- Code snippets where they add insight (keep short, <=10 lines)
- `## Notes` human protection zone at the end

**Maximum length**: 300 lines per page. If a topic needs more, split into focused sub-pages.

**Page focus**: Each page covers a single entity, concept, or interaction pattern. Prefer many focused pages over few large ones. Examples:
- `scheduler-architecture.md` -- high-level scheduling design
- `kv-cache-eviction.md` -- KV cache allocation and eviction strategy
- `scheduler-kv-interaction.md` -- how scheduler decisions depend on KV cache state

### What to include / exclude

**Include (non-derivable)**:
- Design decisions and their WHY (code only tells What)
- Non-obvious pitfalls (require experience or deep analysis to discover)
- Cross-component interactions (require understanding multiple subsystems)
- Performance characteristics (not visible from code alone)
- Synthesized understanding and key insights

**Exclude (derivable from code)**:
- API signatures -> `grep "def function_name"`
- File path tables -> `glob/find`
- Class hierarchy diagrams -> LSP / grep
- Enum definitions, config option lists -> read source code

## index.md Format

Content catalog organized by category. Each entry links to a page with a one-line summary.

```markdown
# Wiki Index

## Architecture
- [[scheduler-architecture]] -- How the scheduler dispatches decode batches
- [[kv-cache-management]] -- KV cache allocation and eviction strategies

## Concepts
- [[mla-vs-mha]] -- Tradeoffs between Multi-Latent and Multi-Head Attention

## Operations
- [[batch-scheduling-algorithm]] -- Scoring and priority logic for batch formation

## Interactions
- [[scheduler-kv-interaction]] -- How scheduler decisions depend on KV cache state
```

**Rules**:
- Each entry: `- [[page-name]] -- summary (<=120 chars)`
- Grouped by category (LLM creates/manages categories organically)
- Maximum 300 lines. If exceeded, split categories into separate index files.
- Updated on every ingest operation

## log.md Format

Append-only chronological record of wiki operations. Newest date section at top.

```markdown
# Wiki Log

## 2026-04-07
- **ingest** scheduler-architecture, kv-cache-management, batch-scheduling-algorithm -- full research from vllm@abc1234
- **query** "how does decode batching interact with KV eviction" -- answered from 3 pages, filed scheduler-kv-interaction

## 2026-04-05
- **lint** -- 12 pages scanned, 3 stale, 1 orphan, 2 missing cross-refs
```

**Entry format**: `- **{operation}** {pages-or-query} -- {summary}`

**Parseable**: Each date header starts with `## [YYYY-MM-DD]` or `## YYYY-MM-DD`, enabling `grep "^## " log.md | tail -5` for recent activity.

## Human Protection Zone Protocol

Every wiki page ends with a `## Notes` section.

**AI rule**: When refreshing a page, parse existing `## Notes` content and preserve it verbatim. Do not modify, delete, or move any content under this heading. If `## Notes` does not exist, create it as an empty section at the end.

## Freshness Tracking

Each page stores `repo_commits` in frontmatter, mapping repo names to the git commit hash that was current when the page was last updated.

```yaml
repo_commits:
  vllm: "abc1234"
  dynamo: "def5678"
```

**Staleness check**: Compare stored commits against current base worktree HEAD.
- **FRESH**: all commits match -> page is current
- **STALE**: one or more commits differ -> delta update needed
- **MISS**: no matching page exists -> full research needed

Pages are checked individually — one stale page does not invalidate other pages.

## Writing Guidelines

Use whatever structure best serves the topic. Some general guidance:
- **Architecture topics**: Start with the big picture (request/data journey), then drill into components
- **Optimization topics**: Start with the problem/motivation, then walk through the solution with numbers
- **Interaction topics**: Show how components connect, what data flows between them, failure modes
- Include `file.py:line` citations for all class/method references
- ASCII diagrams encouraged for data flow and architecture
- Keep code snippets short (<=10 lines) — just enough to show the key logic

## Ingest Flow (learn stage)

```
/devflow:learn <topic>  or  auto-triggered by code-plan
  |
  +-- INIT: resolve WIKI_DIR (vault or .dev/wiki fallback)
  +-- CHECK: glob wiki/ for pages matching topic
  |     +-- FRESH -> load for context, skip write
  |     +-- STALE -> delta research (git diff/log)
  |     +-- MISS  -> full research (explore base worktrees)
  +-- RESEARCH: read source code in base worktrees
  +-- WRITE_PAGES: create/update 1-15 focused pages with [[wikilinks]]
  +-- UPDATE_INDEX: update wiki/index.md + append wiki/log.md
  +-- REPORT: output page list, line counts, repos researched
```

A single ingest may touch many existing pages to add cross-references or update stale content.
