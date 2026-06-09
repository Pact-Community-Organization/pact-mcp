## Summary

<!-- Brief description of what this PR does -->

## Story / Issue

Closes #

## Diff-Spec

<!--
REQUIRED: Link to the approved technical approach, ADR, or architecture comment.
diff-spec: <url or #issue-comment-url>
-->
diff-spec:

## Changes

-

## Quality Gate Phase

- [ ] Gate 1 — Pre-Code (requirements + architecture approved before coding began)
- [ ] Gate 2 — Pre-Merge (QA + security audit complete)
- [ ] Gate 3 — Pre-Deploy (Tester GO + Security APPROVE received)

## Checklist

### Developer (Author)
- [ ] TypeScript compiles with no errors (`pnpm typecheck`)
- [ ] All unit tests pass (`pnpm test`)
- [ ] Tool schemas validated against `tools.lock.json` (if schema changed, lock updated)
- [ ] No new `any` types introduced without justification
- [ ] Input validation at all MCP tool entry points
- [ ] No secrets or credentials committed
- [ ] Diff-spec link populated above

### Tester (QA Review)
- [ ] Test coverage: happy path + error cases + boundary inputs
- [ ] MCP tool invocations tested end-to-end against target service
- [ ] New tools have both success and failure test cases
- [ ] Regression suite passes with no new failures

### Security (Security Review)
- [ ] All tool inputs sanitized before passing to shell or network calls
- [ ] No SSRF vectors introduced (URL inputs validated)
- [ ] No privilege escalation via tool composition
- [ ] Dependency audit clean (`pnpm audit`)

## Auto-Merge

- [ ] I acknowledge this PR will be auto-merged once all required approvals and status checks pass
