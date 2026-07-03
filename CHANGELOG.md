# Changelog

All notable changes to Pact Community MCP servers will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Lock steal race in `mcp-coordination` that could delete a live lock mid-write
  (empty/malformed lock payloads are no longer treated as epoch-stale)
- Servers now start from any working directory: each package ships its own
  `tools.lock.json` and resolves it relative to the installed module
- Dependency audit is clean again (hono, ws, qs patch bumps)
- Dependabot no longer watches non-existent packages

### Changed
- License unified to Apache-2.0 across all manifests (LICENSE was already Apache-2.0)
- Packages now target the public npm registry and include `mcpName` +
  `server.json` manifests for the MCP registry
- `.mcp.json` rewritten in the standard `mcpServers` client format
- CI: coverage lane serialized, lockfile drift now actually regenerates and
  diffs, no-op lint job removed, Node 24 added to the build matrix

### Added
- Initial monorepo scaffold
- `@pact-community/mcp-shared` package with security baseline
- Shared security baseline controls implementation

### Security
- Audit logging system for all tool invocations
- Input sanitization to prevent prompt injection
- Tool schema drift detection via `tools.lock.json`
- Network and filesystem access controls

## [1.0.0] - 2026-04-21

### Added
- MCP monorepo foundation
- Security baseline implementation
- Documentation and CI/CD pipeline

[Unreleased]: https://github.com/Pact-Community-Organization/pact-mcp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Pact-Community-Organization/pact-mcp/releases/tag/v1.0.0