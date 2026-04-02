# Workflow: log

<purpose>Quick checkpoint: append a timestamped entry to the devlog.</purpose>

<process>
<step name="LOG" priority="first">
```bash
INIT=$(node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" init log)
FEATURE=$(echo "$INIT" | jq -r '.feature.name')
PHASE=$(echo "$INIT" | jq -r '.feature.phase')
TAG=$(echo "$INIT" | jq -r '.feature.current_tag // "none"')
```

Checkpoint (@references/shared-patterns.md#checkpoint):
```bash
node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" checkpoint \
  --action "log" \
  --summary "$ARGUMENTS"
```

Output: `Checkpoint: $FEATURE ($PHASE) — $ARGUMENTS`
</step>
</process>
