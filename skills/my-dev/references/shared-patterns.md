# Shared Workflow Patterns

Reusable patterns referenced by multiple workflows via `@references/shared-patterns.md#<pattern-id>`.

---

## experience-sink

Conditional experience persistence to Obsidian. Triggers only on anomalies — clean runs skip silently.

**Workflow provides these parameters:**

| Parameter | Description | Example |
|-----------|-------------|---------|
| `detection_criteria` | List of boolean conditions; ANY true triggers the sink | Pod stuck >5min, hooks warned |
| `target_file` | Experience file name under `experience/` | `k8s-deploy-lessons.md` |
| `context_fields` | Workflow-specific context for the pattern | `tag=$TAG, cluster=$CLUSTER` |

**Protocol:**

1. Evaluate `detection_criteria`. If ALL false → **skip silently, return**.
2. Resolve path:
   ```bash
   EXPERIENCE_DIR="$VAULT/$DEVLOG_GROUP/experience"
   ```
3. Prompt:
   ```
   Workflow encountered issues. Save experience? [Y/n]
     → experience/<target_file>
   ```
4. If yes (default), create/append to `$EXPERIENCE_DIR/<target_file>`:
   ```markdown
   ## Pattern: <issue_summary> (<TODAY>)
   **Symptom**: <what was observed>
   **Root Cause**: <why it happened>
   **Fix**: <what resolved it>
   **Anti-patterns**: <investigation directions that looked promising but were wrong, and why>
   **Prevention**: <learned hook or manual check>
   **Context**: <context_fields>
   ```
5. If file exists, APPEND new `## Pattern:` section (never overwrite).

---

## checkpoint

Standardized checkpoint call. Tag is auto-resolved from feature config — do not pass manually.

**Workflow provides:**

| Parameter | Description | Example |
|-----------|-------------|---------|
| `action` | Workflow name | `build`, `deploy`, `code-exec` |
| `summary` | One-line description of what happened | `Deployed kimi-pd-v2 to paigpu-a` |

**Call:**
```bash
node "$DEVFLOW_BIN" checkpoint \
  --action "<action>" \
  --summary "<summary>"
```

**Rules:**
- ONE checkpoint per workflow execution (no duplicates)
- Tag auto-resolved from `feature.current_tag` in config
- Do not pass `--tag` or `--result` flags

---

## state-update

Update feature stage and activity timestamp after workflow completion.

**Workflow provides:**

| Parameter | Description | Example |
|-----------|-------------|---------|
| `stage` | Target pipeline stage | `spec`, `plan`, `exec`, `review`, `build`, `deploy`, `verify` |

**Call:**
```bash
node "$DEVFLOW_BIN" state update phase <stage>
```

The CLI automatically updates `last_activity` timestamp when updating phase.
