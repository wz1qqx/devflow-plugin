# Code Review: {{FEATURE}}

Date: {{DATE}}
Reviewer: {{REVIEWER}}

## Summary
| Repo | Files Changed | Insertions | Deletions |
|------|--------------|------------|-----------|
| {{REPO}} | {{FILES}} | {{INS}} | {{DEL}} |

## Findings

### CRITICAL (must fix)
{{CRITICAL_FINDINGS}}

### HIGH (should fix)
{{HIGH_FINDINGS}}

### MEDIUM (consider)
{{MEDIUM_FINDINGS}}

## Invariant Compliance
- [ ] source_restriction: all files from dev_worktrees
- [ ] build_compat_check: changes compatible with base_ref API
- [ ] No hardcoded secrets

## Cross-Repo Compatibility
{{CROSS_REPO_CHECK}}

## Verdict
{{VERDICT}}
