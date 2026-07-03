# pact-mcp — MCP Servers for Pact & Chainweb

[![CI](https://github.com/Pact-Community-Organization/pact-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Pact-Community-Organization/pact-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@pact-community/mcp-pact.svg?label=mcp-pact)](https://www.npmjs.com/package/@pact-community/mcp-pact)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node >= 20.11](https://img.shields.io/badge/node-%3E%3D20.11-brightgreen.svg)](package.json)

**Model Context Protocol servers for Pact 5 smart-contract development on
Kadena-style Chainweb networks (KDA-CE).**

Give your AI agent safe, auditable access to the full Pact development loop:
run REPL tests, scan modules for critical language traps, estimate gas, and
query and submit to Chainweb nodes — all behind a strict, tested security
baseline.

## Servers

| Package | npm | Tools | Purpose |
|---------|-----|-------|---------|
| [`@pact-community/mcp-pact`](packages/mcp-pact/) | [![npm](https://img.shields.io/npm/v/@pact-community/mcp-pact.svg)](https://www.npmjs.com/package/@pact-community/mcp-pact) | 6 | Pact CLI tooling: REPL test runs, static trap scanning, gas estimation, interface diff, format check |
| [`@pact-community/mcp-chainweb`](packages/mcp-chainweb/) | [![npm](https://img.shields.io/npm/v/@pact-community/mcp-chainweb.svg)](https://www.npmjs.com/package/@pact-community/mcp-chainweb) | 11 | Chainweb HTTP API: `/local` simulation, pre-signed `/send`, poll, table reads, SPV proofs, module deploys — devnet-first with read-only public profiles |
| [`@pact-community/mcp-shared`](packages/mcp-shared/) | [![npm](https://img.shields.io/npm/v/@pact-community/mcp-shared.svg)](https://www.npmjs.com/package/@pact-community/mcp-shared) | — | Shared security baseline library used by both servers (not itself an MCP server) |

Both servers are also listed in the official
[MCP registry](https://registry.modelcontextprotocol.io) under
`io.github.Pact-Community-Organization/pact` and
`io.github.Pact-Community-Organization/chainweb`.

This repository additionally contains two **internal, unpublished** workspace
tools — [`mcp-devnet`](packages/mcp-devnet/) (docker devnet lifecycle bound to
our workspace layout) and [`mcp-coordination`](packages/mcp-coordination/)
(file-backed agent coordination with a fixed roster). They are built and
tested in CI but intentionally not distributed: they assume infrastructure
that only exists in our own workspace.

## Quick Start

### From npm (recommended)

Both servers are published to the public npm registry and run via `npx` — no
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

### Your first 10 minutes

1. **Install the Pact CLI** (needed by `mcp-pact` for REPL runs and gas
   estimation): download a release from
   [kadena-io/pact-5](https://github.com/kadena-io/pact-5/releases), put
   `pact` on your `PATH`, and check it with `pact --version`.
2. **Add the servers** to your MCP client using the config above, with
   `PACT_COMMUNITY_WORKSPACE_ROOT` pointing at your contract project.
3. **Try it** — ask your agent things like:
   - *"Scan `contracts/token.pact` for critical Pact 5 traps"* → `pact.module_scan`
     flags non-binary `+`, DB reads inside `enforce`, built-in shadowing, and more.
   - *"Run `tests/token.repl` and summarize the failures"* → `pact.repl_run`
     executes the file with the real Pact interpreter and parses the results.
   - *"Diff the public interface of `token.pact` against `token-v2.pact`"* →
     `pact.interface_diff` reports added/removed/changed functions and whether
     the change is breaking.
   - With a local devnet running: *"What's the current block height on chain 0?"*
     → `chainweb.info` / `chainweb.chain_time` against `http://localhost:8081`.

No devnet? Everything in `mcp-pact` works with just the CLI. For `mcp-chainweb`,
any Chainweb-compatible node works — point `PACT_COMMUNITY_CHAINWEB_BASE_URL` at
it, or use the read-only `testnet06`/`mainnet` profiles to query public networks.

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
| `mcp-devnet` *(internal, unpublished)* | — | ✅ | — | — |
| `mcp-coordination` *(internal, unpublished)* | ✅ (offline) | ✅ (offline) | ✅ (offline) | ✅ (offline) |

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
