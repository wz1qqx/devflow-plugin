# Knowledge Conventions Reference

<purpose>Authoritative reference for the dual-layer knowledge base design. All knowledge-related workflows (learn, knowledge-maintain) reference this document for file formats, writing styles, and organizational rules.</purpose>

## Dual-Layer Architecture

```
Obsidian Vault/{group}/
├── knowledge/      ← AI 消费摘要（精简，≤200 行）
├── deep/           ← 人类深度学习（教学文章，300-500 行）
├── _moc-{group}.md ← 架构全景 MOC
└── _conventions.md ← 完整规范文档（人类参考用）
```

**派生关系**：deep → knowledge（deep 是源头，knowledge 从 deep 提炼）。

## knowledge/ 层格式

```yaml
---
date: YYYY-MM-DD
project: {group}
freshness: {version}
repo_commits:
  {repo}: "{commit_hash}"
confidence: high|medium|low
parent: "[[_moc-{group}]]"
tags: [project/{group}, knowledge, insight]
---
```

正文结构（按顺序，仅含有内容的部分）：
1. `> 完整教学文章：[[deep/xxx|Deep Dive: 标题]]` — 反向链接
2. `## Key Insight` — 2-4 句叙事段落
3. `## Design Decisions` — 决策 + Why
4. `## Gotchas` — 按严重程度分层（致命级/易踩坑/细节级）
5. `## Cross-component Interactions` — 用 [[wikilink]] 引用
6. `## Performance Notes`
7. `## Related` — wikilink + 一句话说明关系
8. `## Notes` — 人类保护区，**AI 刷新时原样保留**

**禁止内容**：函数签名、代码片段、文件路径表、类层次图。总长度 ≤200 行。

## deep/ 层格式

```yaml
---
date: YYYY-MM-DD
project: {group}
freshness: {version}
type: deep-dive
style: architecture|optimization
parent: "[[_moc-{group}]]"
tags: [project/{group}, deep-dive, {style}]
---
```

正文结构：
1. `> AI 摘要版：[[knowledge/xxx]]` — 反向链接
2. 导言段落
3. `## 文章结构` — 编号列表预览
4. 正文章节（含源码引用 `file.py:line`）
5. `## Notes` — 人类保护区，**AI 刷新时原样保留**

### 两种写作风格

| 风格 | 适用 | 结构 | 主线 |
|------|------|------|------|
| architecture | 系统、协议、数据流 | 反向金字塔（先全景再细节） | 请求/数据的旅程 |
| optimization | 算法、缓存、性能 | 自底向上（问题→方案） | 优化进程 |

**内容要求**：必须基于源码，类名/方法签名标注 file:line，代码片段 ≤10 行，ASCII 图。

## 人类保护区协议

每篇 knowledge 和 deep 文章末尾必须有 `## Notes` 区域。

**AI 规则**：刷新文档时，解析已有 `## Notes` 后的全部内容并原样保留。不得修改、删除或移动。

## 刷新流程

1. 读 base worktree 代码
2. 先更新 deep/（保留 Notes）
3. 再从 deep 提炼 knowledge/（保留 Notes）
4. 更新 INDEX、MOC、deep/_index.md
5. 更新 frontmatter 的 freshness 和 repo_commits
