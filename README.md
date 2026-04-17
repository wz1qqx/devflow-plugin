# devteam plugin 修复

更新到新版本后发现的三个 bug 及修复方案。运行 `bash apply.sh` 一键修复。

## Bug 1: JSON 解析失败（session.cjs:94）

**症状**：`init pause/status` 返回 JSON 包含非法控制字符，下游 JSON.parse() 报 `Bad control character`

**根因**：`session.cjs:94` 把 context.md 原始内容赋给 `raw`，若文件含 ANSI 颜色码（ESC 0x1B）等控制字符，JSON.stringify 的输出会包含未转义的 0x0B/0x0C/0x0E-0x1F，违反 JSON spec

**修复位置**：`lib/session.cjs:94`
```diff
-    raw: content,
+    raw: content.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ''),
```

---

## Bug 2: init status 不自动识别 active feature（init.cjs:35）

**症状**：`node devteam.cjs init status`（不带 --feature）返回 `"feature": null`，即使 STATE.md 存在

**根因**：`config.cjs:303` resolveFeatureName() 多 feature 时直接返回 null，未从 STATE.md 修改时间推断最近活跃 feature

**修复位置**：`lib/init.cjs:35`（在 featureOverride 声明后插入 fallback）
```diff
-  const featureOverride = parsed.feature || null;
+  let featureOverride = parsed.feature || null;
+  if (!featureOverride) {
+    const devFeaturesDir = path.join(root, '.dev', 'features');
+    if (fs.existsSync(devFeaturesDir)) {
+      let latestMtime = 0, latestFeature = null;
+      for (const name of fs.readdirSync(devFeaturesDir)) {
+        const statePath = path.join(devFeaturesDir, name, 'STATE.md');
+        try {
+          const stat = fs.statSync(statePath);
+          if (stat.isFile() && stat.mtimeMs > latestMtime) {
+            latestMtime = stat.mtimeMs; latestFeature = name;
+          }
+        } catch (_) {}
+      }
+      if (latestFeature) featureOverride = latestFeature;
+    }
+  }
```

---

## Bug 3: DEVTEAM_BIN 路径失效（所有 skill 文件 INIT 步骤）

**症状**：pause/resume/learn/orchestrator 等 skill 的 DEVTEAM_BIN 发现命令返回空字符串

**根因**：skills 里硬编码旧 cache 路径 `~/.claude/plugins/cache/devteam/devteam/*/lib/devteam.cjs`，插件更新后实际路径变为 `marketplaces/devteam/lib/devteam.cjs`

**修复位置**：pause.md / resume.md / learn.md / orchestrator.md / setup-k8s-grafana.md
```diff
-DEVTEAM_BIN=$(ls ~/.claude/plugins/cache/devteam/devteam/*/lib/devteam.cjs 2>/dev/null | head -1)
+DEVTEAM_BIN="${HOME}/.claude/plugins/marketplaces/devteam/lib/devteam.cjs"
+[ -f "$DEVTEAM_BIN" ] || DEVTEAM_BIN=$(find "${HOME}/.claude/plugins/cache/devteam" -name "devteam.cjs" -path "*/lib/devteam.cjs" 2>/dev/null | head -1)
```

---

## 应用修复

```bash
bash /Users/ppio-dn-289/Documents/devteam/apply.sh
```
