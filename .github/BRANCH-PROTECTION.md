# Branch Protection — pact-mcp

Runbook for protecting `main`. Not currently applied (solo-maintainer repo);
apply once there is more than one committer or before accepting external PRs.

## main branch required settings

### Required status checks
- `Test & Coverage`
- `Security Audit`
- `Tools Lockfile Drift Check`
- `PR Quality Gate / validate-metadata`

### Apply via `gh` CLI
```bash
gh api repos/Pact-Community-Organization/pact-mcp/branches/main/protection \
  --method PUT \
  --field 'required_status_checks[strict]=true' \
  --field 'required_status_checks[contexts][]=Test & Coverage' \
  --field 'required_status_checks[contexts][]=Security Audit' \
  --field 'required_status_checks[contexts][]=Tools Lockfile Drift Check' \
  --field 'required_status_checks[contexts][]=PR Quality Gate / validate-metadata' \
  --field 'enforce_admins=true' \
  --field 'required_pull_request_reviews[required_approving_review_count]=1' \
  --field 'required_pull_request_reviews[dismiss_stale_reviews]=true' \
  --field 'allow_force_pushes=false' \
  --field 'allow_deletions=false' \
  --field 'required_linear_history=true'
```
