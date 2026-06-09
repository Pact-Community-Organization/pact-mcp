# Changelog

All notable changes to `@pact-community/mcp-coordination` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[SemVer](https://semver.org/).

## [0.1.0] — 2026-04-24

### Added
- Initial release. 10 MCP tools covering task queue, mailbox, agent
  status, and scoped memory log.
- Inline ADR-MCP-001 security baseline (uid refusal, env allowlist,
  audit log, tool schema lockfile check).
- Atomic writes via tmp+fsync+rename; cooperative `<path>.lock` files
  with 30s stale-lock steal; `O_APPEND` for JSONL.
- ULID-based `T_…` task and `M_…` message ids.
- Path-traversal and symlink-escape hardening.
