# Changelog

All notable changes to Pact Community MCP servers will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial monorepo scaffold
- `@pact-community/mcp-shared` package with security baseline
- ADR-MCP-001 security controls implementation

### Security
- Audit logging system for all tool invocations
- Input sanitization to prevent prompt injection
- Tool schema drift detection via `tools.lock.json`
- Network and filesystem access controls

## [1.0.0] - 2026-04-21 (Phase 1.1)

### Added
- MCP monorepo foundation
- Security baseline implementation
- Documentation and CI/CD pipeline

[Unreleased]: https://github.com/Pact-Community-Organization/pact-examples/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Pact-Community-Organization/pact-examples/releases/tag/v1.0.0