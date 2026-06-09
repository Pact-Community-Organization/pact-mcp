# Pact Community MCP Servers

**Model Context Protocol servers for Pact Community blockchain tooling.**

This monorepo provides secure, audited MCP servers for Kadena Community Edition (KDA-CE) blockchain interactions, following ADR-MCP-001 security baseline.

## Architecture Overview

- **Security-first design**: All servers implement audit logging, input sanitization, and capability restrictions
- **Kadena-native**: Built specifically for Pact 5 smart contracts on KDA-CE 20-chain architecture
- **Multi-agent integration**: Designed for Pact Community 11-agent community workspace

## Browser MCP

Two external MCP servers provide visual testing capabilities:

| Server | Purpose | Agent Usage |
|--------|---------|-------------|
| **Playwright** | Browser automation, screenshots, accessibility testing | WebDev (UI verification), Tester (visual testing), Security (accessibility audit) |
| **Chrome DevTools** | Live DOM/CSS inspection, network analysis, console logs | All agents for diagnosing visual test failures |

### Security

- **Allowed origins**: Restricted to local dev servers (`localhost:3000-4321`) and devnet (`localhost:8081-8083`)
- **Isolated sessions**: Clean browser profile per session, no persistent data 
- **Output containment**: Screenshots and traces saved to `/docs/artifacts/playwright-mcp/`

### Example Usage

```
# Take accessibility snapshot
"Navigate to http://localhost:3000 and capture an accessibility tree snapshot"

# Visual regression test
"Screenshot the login form at http://localhost:3000/login and highlight interactive elements"

# DevTools inspection
"Connect to Chrome and inspect the network requests when submitting the form"
```

## Packages

| Package | Purpose | Status |
|---------|---------|--------|
| [`@pact-community/mcp-shared`](packages/mcp-shared/) | Common security baseline and utilities | ✅ |
| [`@pact-community/mcp-pact`](packages/mcp-pact/) | Pact smart contract interactions | 🚧 Phase 1.2 |
| [`@pact-community/mcp-chainweb`](packages/mcp-chainweb/) | Chainweb API and transaction monitoring | 🚧 Phase 1.2 |
| [`@pact-community/mcp-devnet`](packages/mcp-devnet/) | Devnet lifecycle and environment operations | ✅ |
| [`@pact-community/mcp-coordination`](packages/mcp-coordination/) | Task, mailbox, and status coordination tooling | ✅ |

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Security audit
pnpm audit
```

## Security

- All servers implement **ADR-MCP-001** security baseline
- Audit logs at `~/.pact-community/mcp-audit.log.YYYY-MM-DD`
- Input sanitization prevents prompt injection
- Network/filesystem access controlled via allowlists
- Tool schema drift detection via `tools.lock.json`

See [SECURITY.md](SECURITY.md) for threat model and baseline checklist.

## Development

- **Node.js**: >=20.11.0
- **Package manager**: pnpm >=9
- **TypeScript**: Strict mode with composite references
- **Testing**: Vitest with ≥90% function coverage requirement

## License

MIT