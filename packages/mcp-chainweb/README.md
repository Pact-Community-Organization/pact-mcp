# @pact-community/mcp-chainweb

MCP server exposing eleven Chainweb HTTP tools for Pact development
(devnet-first with read-only public profiles).

**Status:** 0.2.0 — devnet default, `testnet06`/`mainnet` read-only

## Tools

| Name | Purpose | Read-only | Destructive |
|---|---|---|---|
| `chainweb.info` | Fetch `/info`, validate network ID, enumerate chain IDs | ✅ | ❌ |
| `chainweb.chain_time` | Current chain time in seconds for a given chain | ✅ | ❌ |
| `chainweb.local` | `/local` Pact simulation with configurable `preflight` (default `true`), unwrapped result | ✅ | ❌ |
| `chainweb.send` | Preflight then `/send` a pre-signed `{cmd,hash,sigs}` tx | ❌ | ✅ |
| `chainweb.poll` | `/poll` (not `/listen` — nginx 504 trap) until keys resolve | ✅ | ❌ |
| `chainweb.read_table` | Read a single Pact table row via `/local` (unwrapped) | ✅ | ❌ |
| `chainweb.keys` | List row keys of a Pact table (`take` limited) | ✅ | ❌ |
| `chainweb.principal_namespace` | Compute `n_<40hex>` principal namespace name from a keyset | ✅ | ❌ |
| `chainweb.deploy_module` | Build UNSCOPED-signer module deploy (+ create-table same tx), preflight, optionally submit | ❌ | ✅ |
| `chainweb.continue_pact` | Build scoped-signer defpact continuation, preflight, optionally submit | ❌ | ✅ |
| `chainweb.spv_proof` | Fetch base64 SPV proof for a cross-chain tx (ready=false when pending) | ✅ | ❌ |

The server **never** accepts private keys. `chainweb.send`,
`chainweb.deploy_module`, and `chainweb.continue_pact` require signatures
to be supplied by the caller (e.g. Ledger signer or upstream
`@kadena/client`). Without `sigs`, the deploy/continue tools return the
unsigned envelope for external signing.

For `testnet06` and `mainnet` profiles, write tools are intentionally
blocked with `PROFILE_WRITE_BLOCKED` even if signatures are supplied.

### v0.2 tool notes

- `read_table` keys are validated to reject `"` and `\\` — prevents Pact
  code injection via string-literal escape. Row JSON is capped at 1 MB.
- `deploy_module` enforces an **UNSCOPED** signer by construction —
  scoped signers cannot satisfy the `enforce-keyset` guards that Pact
  module governance checks. `create-table` calls are appended inside the
  SAME tx (a split tx fails with "Module admin is necessary").
- `continue_pact` uses a **SCOPED** signer (default `coin.GAS`). Callers
  manage any continuation transitive-deps references via `envData`;
  the tool does not auto-inject them.
- `spv_proof` returns `ready: false` for "not ready", "pending",
  "awaiting" responses — callers should poll, not treat as error.

## Configuration

| Variable | Default | Required | Description |
|---|---|---|---|
| `PACT_COMMUNITY_WORKSPACE_ROOT` | — | ✅ | Absolute path, must not be `/` |
| `PACT_COMMUNITY_CHAINWEB_MODE` | — | ✅ | Must be one of `devnet`, `testnet06`, `mainnet` and match `PACT_COMMUNITY_CHAINWEB_PROFILE` |
| `PACT_COMMUNITY_CHAINWEB_PROFILE` | `devnet` | | Explicit network profile: `devnet`, `testnet06`, `mainnet` |
| `PACT_COMMUNITY_CHAINWEB_BASE_URL` | profile default | | Origin must be in the selected profile allowlist |
| `PACT_COMMUNITY_CHAINWEB_NETWORK_ID` | profile default | | Strictly validated against node `/info` |
| `PACT_COMMUNITY_TOOLS_LOCKFILE` | packaged `tools.lock.json` | | Override the tool-schema drift lockfile |

Profile allowlists (hard-coded, not configurable):
- `devnet`: `http://localhost:8081`, `http://localhost:8082`, `http://localhost:8083`
- `testnet06`: `https://api.testnet.chainweb.com`
- `mainnet`: `https://api.chainweb-community.org`

## Quickstart

```bash
pnpm --filter @pact-community/mcp-chainweb build
node packages/mcp-chainweb/dist/bin.js  # stdio transport
```

MCP client configuration:

```json
{
  "mcpServers": {
    "chainweb": {
      "command": "node",
      "args": ["/path/to/pact-mcp/packages/mcp-chainweb/dist/bin.js"],
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

Network profile roadmap:

- `devnet` is the default profile and enables read + write tools.
- `testnet06` and `mainnet` are implemented as read-only public profiles.
- Write tools (`send`, `deploy_module`, `continue_pact`) return `PROFILE_WRITE_BLOCKED` on public profiles.

## Boundary behaviour

- Pact JSON types (`{int:N}`, `{decimal:"N.M"}`, `{time:"..."}`) are
  recursively unwrapped before returning — no silent `NaN` / row-key
  drift.
- `creationTime` from the block header endpoint is converted from
  microseconds to seconds.
- The block header endpoint always includes
  `Accept: application/json;blockheader-encoding=object`.

## Testing

```bash
pnpm --filter @pact-community/mcp-chainweb test -- --coverage
```

See `SECURITY.md` for the threat model.
