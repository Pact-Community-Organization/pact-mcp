# Contributing to pact-mcp

## Development Setup

### Prerequisites

- **Node.js** >= 20.11.0
- **pnpm** >= 9

### Installation

```bash
git clone https://github.com/Pact-Community-Organization/pact-mcp.git
cd pact-mcp

pnpm install
pnpm build
pnpm test
```

## Development Workflow

### Branch Naming

```
feature/mcp-{server-name}-{feature}
bugfix/mcp-{issue-number}-{description}
```

### Commit Convention

All commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(mcp-shared): add audit log rotation

fix(mcp-pact): handle missing keyset in transaction

security(mcp-chainweb): prevent network allowlist bypass
```

### Security Requirements

Every MCP server implements the shared security baseline (see
[SECURITY.md](SECURITY.md)):

- Root refusal (`process.getuid() !== 0`)
- Audit logging with SHA-256 input hashing
- Input sanitization for prompt-injection prevention
- Environment variable allowlisting
- Tool schema drift detection
- Network and filesystem access controls

### Testing Standards

- **Coverage**: >= 90% functions, >= 85% lines, >= 80% branches (enforced in CI)
- **Unit tests**: every public function
- **Security tests**: attack vectors and boundary conditions
- **Integration tests**: end-to-end server workflows over stdio

```bash
pnpm test                                 # all packages, serial
pnpm -F @pact-community/mcp-shared test   # one package
pnpm -r test:coverage                     # with coverage gates
```

### Code Standards

- **TypeScript strict mode**, ESM only (`type: "module"`)
- **Pinned runtime dependencies** (no `^` or `~`)
- **JSDoc** on public APIs

### Tool Schema Locking

When you add or change a tool schema, regenerate the lockfiles and commit the
result (CI fails on drift):

```bash
pnpm build
pnpm lock:regen
```

## Pull Request Process

1. CI must be green: build, typecheck, tests + coverage, audit, lockfile drift.
2. Security-sensitive changes (new tools, spawn/network/fs code paths) should
   include tests demonstrating the attack they block.
3. Update the affected package `CHANGELOG.md` under `[Unreleased]`.

## Reporting Security Issues

Never open a public issue for a vulnerability — see
[SECURITY.md](SECURITY.md) for private reporting.
