# pact-mcp — MCP Servers for Pact & Chainweb

[![CI](https://github.com/Pact-Community-Organization/pact-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Pact-Community-Organization/pact-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@pact-community/mcp-pact.svg?label=mcp-pact)](https://www.npmjs.com/package/@pact-community/mcp-pact)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node >= 20.11](https://img.shields.io/badge/node-%3E%3D20.11-brightgreen.svg)](package.json)

**Model Context Protocol servers for Pact 5 smart-contract development on
Kadena-style Chainweb networks (KDA-CE).**

Give your AI agent safe, auditable access to the full Pact development loop:
run REPL tests, scan modules for critical language traps, estimate gas, query
and submit to Chainweb nodes, and manage local devnets — all behind a strict,
tested security baseline.

## Servers

| Package | npm | Tools | Purpose |
|---------|-----|-------|---------|
| [`@pact-community/mcp-pact`](packages/mcp-pact/) | [![npm](https://img.shields.io/npm/v/@pact-community/mcp-pact.svg)](https://www.npmjs.com/package/@pact-community/mcp-pact) | 6 | Pact CLI tooling: REPL test runs, static trap scanning, gas estimation, interface diff, format check |
| [`@pact-community/mcp-chainweb`](packages/mcp-chainweb/) | [![npm](https://img.shields.io/npm/v/@pact-community/mcp-chainweb.svg)](https://www.npmjs.com/package/@pact-community/mcp-chainweb) | 11 | Chainweb HTTP API: `/local` simulation, pre-signed `/send`, poll, table reads, SPV proofs, module deploys — devnet-first with read-only public profiles |
| [`@pact-community/mcp-devnet`](packages/mcp-devnet/) | [![npm](https://img.shields.io/npm/v/@pact-community/mcp-devnet.svg)](https://www.npmjs.com/package/@pact-community/mcp-devnet) | 6 | Devnet lifecycle: gated `docker compose` up/down/reset plus read-only status, health, and logs |
| [`@pact-community/mcp-coordination`](packages/mcp-coordination/) | [![npm](https://img.shields.io/npm/v/@pact-community/mcp-coordination.svg)](https://www.npmjs.com/package/@pact-community/mcp-coordination) | 10 | File-backed multi-agent coordination: task queue, mailboxes, status, memory log — no network, no subprocesses |
| [`@pact-community/mcp-shared`](packages/mcp-shared/) | [![npm](https://img.shields.io/npm/v/@pact-community/mcp-shared.svg)](https://www.npmjs.com/package/@pact-community/mcp-shared) | — | Shared security baseline library used by every server (not itself an MCP server) |

## Quick Start

### From npm (recommended)

All servers are published to the public npm registry and run via `npx` — no
clone or build required. Register them with your MCP client. For Claude Code:

```bash
claude mcp add pact -e PACT_COMMUNITY_WORKSPACE_ROOT=/path/to/your/project \
  -- npx -y @pact-community/mcp-pact
```

Or in JSON client configuration (Claude Desktop, Cursor, VS Code, …):

```json
{
  "mcpServers": {
    "pact": {
      "command": "npx",
      "args": ["-y", "@pact-community/mcp-pact"],
      "env": {
        "PACT_COMMUNITY_WORKSPACE_ROOT": "/path/to/your/project",
        "PACT_COMMUNITY_PACT_BIN": "pact"
      }
    },
    "chainweb": {
      "command": "npx",
      "args": ["-y", "@pact-community/mcp-chainweb"],
      "env": {
        "PACT_COMMUNITY_WORKSPACE_ROOT": "/path/to/your/project",
        "PACT_COMMUNITY_CHAINWEB_MODE": "devnet",
        "PACT_COMMUNITY_CHAINWEB_PROFILE": "devnet",
        "PACT_COMMUNITY_CHAINWEB_BASE_URL": "http://localhost:8081",
        "PACT_COMMUNITY_CHAINWEB_NETWORK_ID": "development"
      }
    }
  }
}
```

Each package README documents its full tool list and environment variables.

### From source (for contributors)

```bash
git clone https://github.com/Pact-Community-Organization/pact-mcp.git
cd pact-mcp
pnpm install
pnpm build
```

A ready-made project configuration pointing at the local builds ships in
[`.mcp.json`](.mcp.json) (used automatically by Claude Code when you open this
repository).

## Security Model

Every server implements the same tested baseline (see [SECURITY.md](SECURITY.md)):

- **Root refusal** — exits immediately when run as uid 0
- **Audit logging** — every tool call logged with SHA-256 input hashes (never raw inputs) to `~/.pact-community/`
- **Prompt-injection stripping** — tool outputs are sanitized before they reach the model
- **Tool schema locking** — servers refuse to start if a tool schema drifts from the shipped `tools.lock.json`
- **Network allowlists** — only approved origins are reachable; public Chainweb profiles are read-only
- **Filesystem boundaries** — path traversal and symlink escapes are rejected
- **Safe spawning** — no shells, argument validation, binary allowlists

`chainweb.send`, `chainweb.deploy_module`, and `chainweb.continue_pact`
never accept private keys: signatures must be produced externally (Ledger,
`@kadena/client`, …) and passed in pre-signed.

## Support Matrix

| Package | Local Pact CLI | Local Devnet | Testnet | Mainnet |
|---|---|---|---|---|
| `@pact-community/mcp-pact` | ✅ | ✅ | planned | planned |
| `@pact-community/mcp-chainweb` | — | ✅ | ✅ read-only | ✅ read-only |
| `@pact-community/mcp-devnet` | — | ✅ | — | — |
| `@pact-community/mcp-coordination` | ✅ (offline) | ✅ (offline) | ✅ (offline) | ✅ (offline) |

Network posture: `mcp-chainweb` defaults to the `devnet` profile. The opt-in
`testnet06` and `mainnet` profiles are read-only — write tools return
`PROFILE_WRITE_BLOCKED`.

## Validation Proof Levels

| Proof level | Lane | What it proves |
|---|---|---|
| L1 | Unit tests (`pnpm test`) | Tool registration, schema validation, local logic, error handling |
| L2 | Binary smoke tests (`pnpm test`) | Built MCP binaries start and answer over stdio |
| L3 | Devnet E2E (`PACT_COMMUNITY_ENABLE_DEVNET_E2E=true pnpm test:e2e:devnet`) | End-to-end read flow against a live devnet |
| L3+ | Devnet send/poll (`PACT_COMMUNITY_ENABLE_DEVNET_E2E_SEND_POLL=true` + signed fixture) | Pre-signed send + poll path over devnet |

Run L3 only when a devnet is actually reachable:

```bash
pnpm build
PACT_COMMUNITY_ENABLE_DEVNET_E2E=true pnpm test:e2e:devnet
```

## Development

```bash
pnpm install          # install workspace dependencies
pnpm build            # build all packages (TypeScript composite)
pnpm test             # run all test suites serially
pnpm typecheck        # tsc --noEmit across packages
pnpm audit            # dependency vulnerability audit
pnpm lock:regen       # regenerate tools.lock.json after schema changes
```

- **Node.js** >= 20.11, **pnpm** >= 9
- Coverage gates: 90% functions / 85% lines / 80% branches, enforced in CI
- See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow and commit conventions

## VS Code Distribution

See [docs/VS-CODE-DISTRIBUTION.md](docs/VS-CODE-DISTRIBUTION.md) for extension
packaging options and a secure update strategy.

## License

[Apache-2.0](LICENSE)
