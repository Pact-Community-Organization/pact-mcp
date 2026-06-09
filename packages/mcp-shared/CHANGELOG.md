# Changelog - @pact-community/mcp-shared

All notable changes to the Pact Community MCP shared package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-04-21

### Added

#### Security Baseline (ADR-MCP-001)
- **Root refusal**: Automatic exit with code 13 if `process.getuid() === 0`
- **Audit logging**: All tool executions logged to `~/.pact-community/mcp-audit.log.YYYY-MM-DD`
- **Input sanitization**: Removes prompt injection markers (`<IMPORTANT>`, `<system>`, `[INST]`, etc.)
- **Tool schema verification**: Drift detection via `tools.lock.json` SHA-256 hashes
- **Environment allowlist**: Validates environment variables against explicit allowlist
- **Network allowlist**: Fetch wrapper with origin-based access controls
- **Filesystem guards**: Path traversal and symlink escape prevention
- **Safe process spawning**: Blocks shell injection, enforces `shell: false`

#### Core Functions
- `startServer()` - MCP server initialization with security baseline
- `createAuditLogger()` - Append-only audit logging with daily rotation
- `sanitizeToolOutput()` - Remove injection markers from tool outputs
- `verifyToolsLock()` - Tool schema drift detection
- `validateEnv()` - Environment variable allowlist validation
- `createAllowlistedFetch()` - Network access control wrapper
- `resolveInsideWorkspace()` - Secure path resolution
- `safeTempDir()` - Secure temporary directory creation
- `spawnSafe()` / `spawnWithOutput()` - Secure process execution

#### Type System
- **Shared Zod schemas**: ChainId, NetworkId, AccountName, PactDecimal, PublicKey, etc.
- **Structured errors**: McpToolError with sanitization and retry flags
- **TypeScript strict mode**: Full type safety with composite project references

#### Testing
- **≥90% function coverage** requirement
- **Comprehensive test suite**: 200+ test cases covering security scenarios
- **Mock-based testing**: Isolated unit tests with proper dependency mocking
- **Attack vector validation**: Tests for path traversal, injection, privilege escalation

### Security
- **ADR-MCP-001 compliance**: Full implementation of Pact Community MCP security baseline
- **Defense in depth**: Multiple layers of validation and sanitization
- **Audit trail**: Complete forensic logging without sensitive data exposure
- **Fail-secure design**: Errors default to denying access rather than permitting

### Technical
- **Node.js ≥20.11.0** requirement for latest security features
- **ESM modules** only for modern JavaScript ecosystem
- **Pinned dependencies** for supply chain security
- **TypeScript 5.6+** with strict mode and composite references

[Unreleased]: https://github.com/Pact-Community-Organization/pact-examples/compare/mcp-shared-v1.0.0...HEAD
[1.0.0]: https://github.com/Pact-Community-Organization/pact-examples/releases/tag/mcp-shared-v1.0.0