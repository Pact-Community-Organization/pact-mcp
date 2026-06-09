# Branch Protection — Pact-Community-Organization MCP

## main branch required settings

### Required status checks
- `Test & Coverage`
- `Lint`
- `Security Audit`
- `PR Quality Gate / validate-metadata`

### Apply via `gh` CLI
```bash
gh api repos/Pact-Community-Organization/mcp/branches/main/protection \
  --method PUT \
  --field 'required_status_checks[strict]=true' \
  --field 'required_status_checks[contexts][]=Test & Coverage' \
  --field 'required_status_checks[contexts][]=Lint' \
  --field 'required_status_checks[contexts][]=Security Audit' \
  --field 'required_status_checks[contexts][]=PR Quality Gate / validate-metadata' \
  --field 'enforce_admins=true' \
  --field 'required_pull_request_reviews[required_approving_review_count]=1' \
  --field 'required_pull_request_reviews[dismiss_stale_reviews]=true' \
  --field 'required_pull_request_reviews[require_code_owner_reviews]=true' \
  --field 'restrictions[teams][]=devops' \
  --field 'restrictions[users][]=' \
  --field 'allow_force_pushes=false' \
  --field 'allow_deletions=false' \
  --field 'required_linear_history=true'
```
