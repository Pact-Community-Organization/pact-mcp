# pact-mcp — MCP servers for Pact & Chainweb

[![CI](https://github.com/Pact-Community-Organization/pact-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Pact-Community-Organization/pact-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@pact-community/mcp-pact.svg?label=mcp-pact)](https://www.npmjs.com/package/@pact-community/mcp-pact)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node >= 20.11](https://img.shields.io/badge/node-%3E%3D20.11-brightgreen.svg)](package.json)

**Model Context Protocol servers that give your AI agent safe, auditable access
to the Pact 5 development loop on Kadena Chainweb.**

Run REPL tests, scan modules for critical language traps, estimate gas, and
query or submit to Chainweb nodes — from Claude, Cursor, VS Code, or any
MCP-compatible client. Every tool runs behind a strict, tested security
baseline, and no tool ever touches a private key.

```json
{
  "mcpServers": {
    "pact": {
      "command": "npx",
      "args": ["-y", "@pact-community/mcp-pact"],
      "env": { "PACT_COMMUNITY_WORKSPACE_ROOT": "/path/to/your/project" }
    }
  }
}
```

## Servers

| Server | Install | Tools | What it does |
|--------|---------|-------|--------------|
| **Pact Tooling** — [`@pact-community/mcp-pact`](packages/mcp-pact/) | [![npm](https://img.shields.io/npm/v/@pact-community/mcp-pact.svg)](https://www.npmjs.com/package/@pact-community/mcp-pact) | 6 | REPL test runs, critical-trap scanning, gas estimation, interface diff, format checks |
| **Chainweb API** — [`@pact-community/mcp-chainweb`](packages/mcp-chainweb/) | [![npm](https://img.shields.io/npm/v/@pact-community/mcp-chainweb.svg)](https://www.npmjs.com/package/@pact-community/mcp-chainweb) | 11 | `/local` simulation, pre-signed `/send`, poll, table reads, SPV proofs, module deploys |

Both are listed in the official
[MCP registry](https://registry.modelcontextprotocol.io) as
`io.github.Pact-Community-Organization/pact` and
`io.github.Pact-Community-Organization/chainweb`.

## Install

### VS Code (one click)

Using VS Code with GitHub Copilot? Install with a single click:

[![Install Pact Tooling in VS Code](https://img.shields.io/badge/VS_Code-Install_Pact_Tooling-0098FF?logo=visualstudiocode&logoColor=white)](vscode:mcp/install?%7B%22name%22%3A%22pact%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40pact-community/mcp-pact%22%5D%2C%22env%22%3A%7B%22PACT_COMMUNITY_WORKSPACE_ROOT%22%3A%22%24%7BworkspaceFolder%7D%22%2C%22PACT_COMMUNITY_PACT_BIN%22%3A%22pact%22%7D%7D)
[![Install Chainweb API in VS Code](https://img.shields.io/badge/VS_Code-Install_Chainweb_API-0098FF?logo=visualstudiocode&logoColor=white)](vscode:mcp/install?%7B%22name%22%3A%22chainweb%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40pact-community/mcp-chainweb%22%5D%2C%22env%22%3A%7B%22PACT_COMMUNITY_WORKSPACE_ROOT%22%3A%22%24%7BworkspaceFolder%7D%22%2C%22PACT_COMMUNITY_CHAINWEB_MODE%22%3A%22devnet%22%2C%22PACT_COMMUNITY_CHAINWEB_PROFILE%22%3A%22devnet%22%2C%22PACT_COMMUNITY_CHAINWEB_BASE_URL%22%3A%22http%3A//localhost%3A8081%22%2C%22PACT_COMMUNITY_CHAINWEB_NETWORK_ID%22%3A%22development%22%7D%7D)

The button opens VS Code and pre-fills the configuration. You can also search
the **MCP Servers** view, or add from the command line:

```bash
code --add-mcp '{"name":"pact","command":"npx","args":["-y","@pact-community/mcp-pact"],"env":{"PACT_COMMUNITY_WORKSPACE_ROOT":"${workspaceFolder}","PACT_COMMUNITY_PACT_BIN":"pact"}}'
```

> On VS Code Insiders, use `vscode-insiders:` in the links or `code-insiders` on
> the command line.

### Claude Code

```bash
claude mcp add pact -e PACT_COMMUNITY_WORKSPACE_ROOT=/path/to/your/project \
  -- npx -y @pact-community/mcp-pact
```

### Any MCP client

Add both servers to your client configuration:

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

Each server's README documents its full tool list and environment variables:
[Pact Tooling](packages/mcp-pact/README.md) ·
[Chainweb API](packages/mcp-chainweb/README.md).

## Your first 10 minutes

1. **Install the Pact CLI** — Pact Tooling uses it for REPL runs and gas
   estimation. Download a release from
   [kadena-io/pact-5](https://github.com/kadena-io/pact-5/releases), put `pact`
   on your `PATH`, and verify with `pact --version`.
2. **Add the servers** to your client with the config above, pointing
   `PACT_COMMUNITY_WORKSPACE_ROOT` at your contract project.
3. **Ask your agent:**
   - *"Scan `contracts/token.pact` for critical Pact 5 traps"* — flags non-binary
     `+`, DB reads inside `enforce`, built-in shadowing, and more.
   - *"Run `tests/token.repl` and summarize the failures"* — executes the file
     with the real Pact interpreter and parses the results.
   - *"Diff the public interface of `token.pact` against `token-v2.pact`"* —
     reports added/removed/changed functions and whether the change is breaking.
   - *"What's the current block height on chain 0?"* — queries a Chainweb node.

Everything in Pact Tooling works with just the CLI — no node required. Chainweb
API works against any Chainweb-compatible node: point
`PACT_COMMUNITY_CHAINWEB_BASE_URL` at your devnet, or use the read-only
`testnet06` / `mainnet` profiles to query public networks.

## Security

Both servers enforce the same tested baseline (details in [SECURITY.md](SECURITY.md)):

- **No private keys, ever.** `chainweb_send`, `chainweb_deploy_module`, and
  `chainweb_continue_pact` require transactions to be signed externally (Ledger,
  `@kadena/client`, …) and passed in pre-signed.
- **Read-only public networks.** The `testnet06` and `mainnet` profiles block
  every write tool with `PROFILE_WRITE_BLOCKED`.
- **Audit logging** of every tool call with SHA-256 input hashes (never raw
  inputs).
- **Prompt-injection stripping** on all tool output before it reaches the model.
- **Tool-schema locking** — a server refuses to start if its tool schemas drift.
- **Network and filesystem allowlists**, no shell execution, and refusal to run
  as root.

## Compatibility

| Server | Local devnet | Testnet | Mainnet |
|--------|:---:|:---:|:---:|
| Pact Tooling | ✅ | — | — |
| Chainweb API | ✅ | ✅ read-only | ✅ read-only |

## Contributing

```bash
git clone https://github.com/Pact-Community-Organization/pact-mcp.git
cd pact-mcp
pnpm install
pnpm build
pnpm test
```

Requires Node.js >= 20.11 and pnpm >= 9. See [CONTRIBUTING.md](CONTRIBUTING.md)
for workflow, coding standards, and how to add or change a tool.

## License

[Apache-2.0](LICENSE)
