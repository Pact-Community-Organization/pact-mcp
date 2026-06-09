# Contributing to Pact Community MCP Servers

## Development Setup

### Prerequisites

- **Node.js** >=20.11.0
- **pnpm** >=9
- **Git** with conventional commit knowledge

### Installation

```bash
# Clone and navigate
git clone <repo>
cd mcp

# Install dependencies
pnpm install

# Build packages
pnpm build

# Run tests
pnpm test
```

## Development Workflow

### 1. Branch Naming

```
feature/mcp-{server-name}-{feature}
bugfix/mcp-{issue-number}-{description}
```

### 2. Commit Convention

All commits must follow conventional commits with agent tag:

```
[Developer] feat(mcp-shared): add audit log rotation

[Developer] fix(mcp-pact): handle missing keyset in transaction

[Developer] security(mcp-chainweb): prevent network allowlist bypass
```

### 3. Security Requirements

Every MCP server MUST implement **ADR-MCP-001** security baseline:

- ✅ Root refusal (`process.getuid() !== 0`)
- ✅ Audit logging with SHA-256 input hashing
- ✅ Input sanitization for prompt injection prevention
- ✅ Environment variable allowlisting
- ✅ Tool schema drift detection
- ✅ Network and filesystem access controls

### 4. Testing Standards

- **Coverage**: ≥90% functions, ≥85% lines, ≥80% branches
- **Unit tests**: Every public function tested
- **Security tests**: Attack vectors and boundary conditions
- **Integration tests**: End-to-end server workflows

### 5. Code Standards

- **TypeScript strict mode** with no `any` types
- **ESM modules** only (`type: "module"`)
- **Pinned dependencies** (no `^` or `~` in runtime deps)
- **Comprehensive JSDoc** on public APIs

## Testing

```bash
# Run all tests
pnpm test

# Coverage report
pnpm test -- --coverage

# Watch mode
pnpm test -- --watch

# Specific package
pnpm -F mcp-shared test
```

## Security

### Audit Logging

All tool executions are logged to `~/.pact-community/mcp-audit.log.YYYY-MM-DD`:

```json
{
  "timestamp": "2026-04-21T10:30:45.123Z",
  "server": "mcp-pact",
  "tool": "deploy-module",
  "inputHash": "sha256:abc123...",
  "exitStatus": 0,
  "durationMs": 1250
}
```

### Tool Schema Verification

Update `tools.lock.json` when adding/modifying tools:

```bash
# Generate new hashes (implementation TBD)
pnpm run lock-schemas
```

## Agent Coordination

This monorepo supports Pact Community 11-agent architecture:

- **Developer** - Implementation and testing
- **Security** - Vulnerability assessment and audit
- **DevOps** - CI/CD and deployment automation
- **Architect** - Design decisions and ADR maintenance

All code should be tagged with the responsible agent: `[Developer]`, `[Security]`, etc.

## Pull Request Process

1. **Security review required** for all MCP server changes
2. **Coverage threshold** must pass (≥90% functions)
3. **Tool schema** must be updated in `tools.lock.json`
4. **Audit log testing** must verify no sensitive data leakage

## Questions?

See the Pact Community workspace documentation or reach out to the Security agent for security-related questions.