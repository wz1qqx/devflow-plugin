---
name: devflow:switch
description: Switch active feature context
argument-hint: "<feature-name>"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
---
<objective>
Switch the active feature by updating defaults.active_feature in .dev.yaml.
Shows the target feature's status and loads its context.
</objective>

<execution_context>
@~/.claude/my-dev/references/schema.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
1. Parse feature name from $ARGUMENTS
2. Load .dev.yaml
3. Verify feature exists in `features:` section
4. If not found → list available features with `node "$HOME/.claude/my-dev/bin/my-dev-tools.cjs" features list`
5. Update `defaults.active_feature` to the target feature
6. Update STATE.md: set current_feature
7. Load and display target feature status:
   ```
   Switched to: <feature-name>
   Description: <description>
   Phase: <phase>
   Scope: <repo1>, <repo2>
   Worktrees:
     <repo>: <dev_worktree> (<base_ref> + N commits)

   Next: <suggested action based on phase>
   ```
8. Auto-load relevant Obsidian knowledge notes for this feature
</process>
