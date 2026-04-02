# Debug & Hooks Reference

Detailed specifications for the debug action and hooks system.

---

## `debug [topic]`

**Scenario**: Investigation when issues are found.

### Entry
1. Create/open investigation log at devlog path:
   `<vault>/<devlog.group>/devlog/<topic>-investigation.md`
2. Load context: knowledge notes + relevant skills (from `skills.debug.<topic>` if configured)
3. Set phase to `debug`

### During Investigation

Log each attempt in the investigation file:
```markdown
### Attempt N — <hypothesis>
**Action**: <what was tried>
**Result**: <what happened>
**Lesson**: <what was learned>
```

### On Root Cause Found
1. Record in investigation log
2. **Prompt: "Save as learned hook?"**
   - Yes → append to `project.hooks.learned[]` in `.dev.yaml`:
     ```yaml
     - name: <descriptive_name>
       trigger: <pre_build|pre_deploy|post_verify|...>
       added: <today's date>
       rule: <human-readable check description>
     ```
   - Also append check logic to `hooks/learned_checks.sh` if it exists
3. **Prompt: "Update knowledge note?"**
   - Yes → update/create relevant knowledge note in vault

### Exit Debug
1. Close investigation log with summary
2. Write checkpoint
3. Suggest next phase

---

## Hook System Details

### Hook Execution Flow

```
action starts
  → run pre_<action> hooks (any failure → ABORT action, show error)
  → execute action core logic
  → run post_<action> hooks (failure → WARN but don't abort)
  → run matching learned hooks for this trigger phase
```

### Hook Resolution

Hooks are referenced by name in `.dev.yaml`. Resolution order:
1. `<workspace>/hooks/<hook_name>.sh` — project-specific scripts
2. If script not found, treat hook name as a built-in check name and warn

### Available Hook Scripts

| Script | Phase | Purpose |
|--------|-------|---------|
| `pre_build_compat_check.sh` | pre_build | Verify patched files compatible with base image API |
| `worktree_uncommitted_check.sh` | pre_build | Ensure all dev worktrees have changes committed |
| `verify_image_imports.sh` | post_build | Verify built image can import key modules |
| `pre_deploy_node_check.sh` | pre_deploy | Node health + stale process cleanup |
| `stale_pod_cleanup.sh` | pre_deploy | Force-delete CrashLoopBackOff/Error/Terminating pods |
| `post_deploy_label_services.sh` | post_deploy | Label headless services for Dynamo discovery |
| `wait_all_pods_ready.sh` | post_deploy | Wait for all pods Running + Ready with timeout |
| `save_bench_json.sh` | post_verify | SCP benchmark JSON from remote to local bench-results/ |
| `update_devlog_checkpoint.sh` | post_verify | Append checkpoint entry to devlog |
| `learned_checks.sh` | any | Run learned checks matching the trigger phase |

### Hook Script Interface

All hook scripts follow a consistent pattern:
- **Input**: Positional args (documented in script header)
- **Output**: Colored log lines with `[✓]` / `[!]` / `[✗]` / `[HOOK]` prefixes
- **Exit code**: 0 = pass, 1 = fail
- **Pre-hooks**: Failure aborts the action
- **Post-hooks**: Failure warns but doesn't abort

### Learned Hooks Mechanism

Learned hooks are auto-generated from debug sessions, creating a self-improving system.

**Storage**: `project.hooks.learned[]` in `.dev.yaml`

**Schema per entry**:
```yaml
- name: <descriptive_name>           # e.g. k8s_port_name_length_check
  trigger: <pre_build|pre_deploy|post_verify|...>
  added: <YYYY-MM-DD>
  rule: <human-readable check description>
```

**Execution**: When an action runs, matching learned hooks are applied:
1. Filter `learned[]` by `trigger` matching current phase
2. For each match, apply the `rule` as a check
3. If `hooks/learned_checks.sh` exists, call it with the trigger phase

**Evolution**: New lessons from debug sessions append to both:
- `.dev.yaml` `learned[]` array (declarative)
- `hooks/learned_checks.sh` (executable, with structured comment blocks)

### Invariants

Read from `project.invariants`. Always-on constraints:

| Key | Effect |
|-----|--------|
| `build_compat_check: true` | Files patched into image MUST be compatible with `base_ref` API |
| `source_restriction: dev_worktree_only` | NEVER copy files from main repo; only from registered dev_worktrees |
| `pre_deploy_node_check: true` | Run node health check before every deploy |

Additional invariants are project-specific (free-form keys).

---

## Investigation Log Format

```markdown
## Investigation: <topic>
Started: YYYY-MM-DD HH:MM
Project: <project>, Tag: <current_tag>

### Attempt N — <hypothesis>
**Action**: <what was tried>
**Result**: <what happened>
**Lesson**: <what was learned>

---

## Resolution
**Root Cause**: <description>
**Fix**: <what was done>
**Learned Hook**: <name> (if created)
**Knowledge Updated**: <yes/no>
```

---

## Checkpoint Format

```markdown
### #N | YYYY-MM-DD HH:MM | <action>: <summary>
**Tag**: <current_tag>
**Details**: <action-specific summary>
**Repos**: <changed repos with commit counts>
```
