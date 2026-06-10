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

## Support Matrix

Status labels:

- `implemented`: supported and covered by default test lane
- `experimental`: available but still stabilizing
- `planned`: design intent exists but not shipped
- `not supported`: intentionally unavailable

### Per package

| Package | Local Pact CLI | Local Devnet | Testnet | Mainnet |
|---|---|---|---|---|
| `@pact-community/mcp-shared` | implemented | implemented | implemented | implemented |
| `@pact-community/mcp-pact` | implemented | implemented | planned | planned |
| `@pact-community/mcp-chainweb` | not supported | implemented | planned | planned |
| `@pact-community/mcp-devnet` | not supported | implemented | not supported | not supported |
| `@pact-community/mcp-coordination` | implemented | implemented | implemented | implemented |

### Network posture

- `mcp-chainweb` is devnet-only by default and rejects non-devnet modes/profiles at startup.
- Future `testnet` and `mainnet` profiles are intentionally scaffolded as explicit profile names but are currently blocked until stricter confirmation and signer policies are implemented.

## Validation Proof Levels

| Proof level | Lane | What it proves | What it does not prove |
|---|---|---|---|
| L1 | Unit tests (`pnpm test`) | Tool registration, schema validation, local logic, error handling | Live node connectivity, real network timing |
| L2 | Binary smoke tests (`pnpm test`) | Built MCP binaries start and return healthful response shapes over stdio | Full devnet behavior under real chain state |
| L3 | Devnet E2E lane (`PACT_COMMUNITY_ENABLE_DEVNET_E2E=true pnpm test:e2e:devnet`) | End-to-end read flow against live devnet (`info`, `local`, `keys`) | Production network behavior, signing custody, finality guarantees |
| L3+ optional | Devnet send/poll (`PACT_COMMUNITY_ENABLE_DEVNET_E2E_SEND_POLL=true` with signed fixture) | Pre-signed send + poll path over devnet | Key management safety, transaction intent correctness |

Run L3 only when an actual devnet is available:

```bash
pnpm build
PACT_COMMUNITY_ENABLE_DEVNET_E2E=true pnpm test:e2e:devnet
```

Enable optional send+poll proof with a pre-signed fixture:

```bash
PACT_COMMUNITY_ENABLE_DEVNET_E2E=true \
PACT_COMMUNITY_ENABLE_DEVNET_E2E_SEND_POLL=true \
PACT_COMMUNITY_DEVNET_SIGNED_TX_JSON=/absolute/path/to/signed-tx.json \
pnpm test:e2e:devnet
```

## VS Code Extension Distribution

See `docs/VS-CODE-DISTRIBUTION.md` for extension packaging options, Marketplace prerequisites, and secure update strategy.

## License

MIT