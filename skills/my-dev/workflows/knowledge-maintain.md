# Workflow: knowledge-maintain

<purpose>Self-maintenance of the knowledge base: prune derivable content, improve quality, refresh staleness, rebuild index.</purpose>
<core_principle>Knowledge notes should contain ONLY non-derivable insights. Everything that can be obtained by reading current code should be pruned. Notes <=200 lines. Index must accurately reflect state.</core_principle>

<references>
@~/.claude/my-dev/references/memory-system.md
@~/.claude/my-dev/references/knowledge-conventions.md
</references>

<process>

<step name="INIT" priority="first">
Load workspace configuration and collect all Tier 2 notes.

```bash
INIT=$(node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init knowledge-maintain)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
VAULT=$(echo "$INIT" | jq -r '.vault // empty')
DEVLOG_GROUP=$(echo "$INIT" | jq -r '.devlog.group // empty')
```

**Vault gate**: If `VAULT` is empty or "null", abort with: "Knowledge maintenance requires Obsidian vault. Set `vault` in .dev.yaml to enable."

If vault configured:
```bash
KNOWLEDGE_DIR="$VAULT/$DEVLOG_GROUP/knowledge"
INDEX="$WORKSPACE/.dev/KNOWLEDGE-INDEX.md"
NOTES=$(find "$KNOWLEDGE_DIR" -name "*.md" -type f)
```
</step>

<step name="ANALYZE">
For each note, run all quality checks in a single pass:

1. **Line count**: Flag if >200 lines
2. **Derivable content**: Search for code blocks with `def`/`class`/`fn`, file path tables, API signatures, import statements
3. **Freshness**: Compare `repo_commits` in frontmatter against current base worktree HEAD. Update confidence: match=high, 1 version behind=medium, 2+=low
4. **Overlap**: Compare Key Insight + Gotchas across notes for >40% similarity
5. **Vague language**: Flag "大概", "可能", "似乎", "好像"

Output: report of findings per note.
</step>

<step name="PRUNE">
Remove derivable content from flagged notes.

Remove: code snippets, function signatures, file path tables, class hierarchies, enum definitions, config option lists.
Preserve: Key Insight, Design Decisions (Why), Gotchas, Cross-component Interactions, Performance Notes.
Verify <=200 lines after pruning.
</step>

<step name="IMPROVE">
Single pass: merge overlapping notes, sharpen vague language, deduplicate cross-note insights.

**Merge** (>40% overlap): Present to user, combine non-redundant insights, archive merged-away note.
**Sharpen**: Replace vague phrases with precise statements verified against base worktree. If unverifiable, set `confidence: low`.
**Deduplicate**: Keep most detailed version in most relevant note, replace others with cross-references `[[primary-note]]`.
</step>

<step name="REBUILD_INDEX">
Rebuild `.dev/KNOWLEDGE-INDEX.md` from current state.

For each note in `knowledge/` and `experience/`:
- Extract Key Insight (≤120 chars)
- Determine freshness status (✓ / ⚠)

Format: `topic | insight_summary | path | version status`
Sections: `## Insights`, `## Experience`, `## Stale`
Verify index ≤200 lines.
</step>

<step name="REPORT">
Output maintenance summary.

```
Knowledge Maintenance Report
Notes scanned: N
  Pruned: X (removed Y lines) | Merged: Z | Sharpened: W | Deduplicated: V
  Freshness: F fresh, S stale

Index rebuilt: .dev/KNOWLEDGE-INDEX.md (E entries)

Suggested: /devflow:learn <stale topics>
```
</step>

</process>
