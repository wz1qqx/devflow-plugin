# Workflow: debug

<purpose>Lightweight investigation mode. Only persist what prevents future wrong turns: root cause, fix, and anti-patterns.</purpose>
<core_principle>Debug freely without recording overhead. On resolution, distill the session into a reusable experience pattern — root cause, fix, and which investigation directions were dead ends.</core_principle>

<process>
<step name="INIT" priority="first">
Initialize debug session and load context.

```bash
INIT=$(node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init debug)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
FEATURE=$(echo "$INIT" | jq -r '.feature.name')
TOPIC="$1"  # Debug topic from arguments
```

If no topic provided, ask: "What are you investigating? (e.g., deploy-stuck, bench-regression, accuracy-drop)"

Extract context:
```bash
CURRENT_TAG=$(echo "$INIT" | jq -r '.feature.current_tag')
VAULT=$(echo "$INIT" | jq -r '.vault')
DEVLOG_GROUP=$(echo "$INIT" | jq -r '.devlog.group')
```

Load related context:
- Experience notes matching topic (`experience/{topic}-patterns.md`) — known root causes help narrow scope
- Knowledge notes matching topic
</step>

<step name="INVESTIGATE">
Free-form investigation. No per-attempt logging — just work with the user interactively.

Investigation actions as needed:
- Read logs: `kubectl logs`, application logs
- Check state: `kubectl describe`, `nvidia-smi`
- Test hypothesis: modify config, restart component
- Compare: diff with known-good state

Continue until root cause found or user exits.
</step>

<step name="RESOLUTION">
On root cause found, generate reusable artifacts.

1. **Offer learned hook**:
   ```
   Save as learned hook? This creates an automatic check for future builds/deploys.
   Name: <suggested_name>
   Trigger: <suggested_phase>
   Rule: <human-readable check>
   ```

   If yes, append to `.dev.yaml` feature `hooks.learned[]`:
   ```yaml
   - name: <name>
     trigger: <phase>
     added: <today>
     rule: <description>
   ```

2. **Offer knowledge update** if the root cause reveals something about system internals worth documenting.
</step>

<step name="EXPERIENCE_SINK">
After resolution, AUTOMATICALLY save experience pattern to Obsidian.
The default is to SAVE. User must explicitly opt out.

```bash
EXPERIENCE_DIR="$VAULT/$DEVLOG_GROUP/experience"
```

Auto-create/append to `$EXPERIENCE_DIR/${TOPIC}-patterns.md`:
```markdown
---
date: <TODAY>
project: $FEATURE
tags: [debug, $TOPIC]
---

# $TOPIC Patterns

## Pattern: <root_cause_name>
**Symptom**: <what was observed>
**Root Cause**: <why it happened>
**Fix**: <what was done>
**Anti-patterns**: <investigation directions that looked promising but were wrong, and why>
**Prevention**: <learned hook name or manual check>
```

Rules:
- If the experience note already exists, APPEND a new `## Pattern:` section
- Anti-patterns section is critical — this is what saves future debug time
- Show the user what was saved and offer to edit

```
Experience saved: experience/<topic>-patterns.md
  Pattern: <symptom> → <root_cause> → <fix>
  Anti-patterns: <dead ends avoided next time>

  Edit? [Y/n/edit]
```
</step>

<step name="CLOSE">
Update state and suggest next step.

```bash
node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" state-md update \
  --last-activity "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

Checkpoint (@references/shared-patterns.md#checkpoint):
```bash
node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" checkpoint \
  --action "debug" \
  --summary "Debug $TOPIC: $ROOT_CAUSE"
```

Suggest next step:
- Deploy issue → "Re-deploy: `/devflow deploy`"
- Build issue → "Re-build: `/devflow build`"
- Bench regression → "Re-verify: `/devflow verify`"
</step>
</process>
