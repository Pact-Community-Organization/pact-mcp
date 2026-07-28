# @pact-community/mcp-chainweb

MCP server exposing eleven Chainweb HTTP tools for Pact development
(devnet-first with read-only public profiles).

**Status:** devnet default, `testnet06`/`mainnet` read-only

## Tools

| Name | Purpose | Read-only | Destructive |
|---|---|---|---|
| `chainweb_info` | Fetch `/info`, validate network ID, enumerate chain IDs | ✅ | ❌ |
| `chainweb_chain_time` | Current chain time in seconds for a given chain | ✅ | ❌ |
| `chainweb_local` | `/local` Pact simulation with configurable `preflight` (default `true`), unwrapped result | ✅ | ❌ |
| `chainweb_send` | Preflight then `/send` a pre-signed `{cmd,hash,sigs}` tx | ❌ | ✅ |
| `chainweb_poll` | `/poll` (not `/listen` — nginx 504 trap) until keys resolve | ✅ | ❌ |
| `chainweb_read_table` | Read a single Pact table row via `/local` (unwrapped) | ✅ | ❌ |
| `chainweb_keys` | List row keys of a Pact table (`take` limited) | ✅ | ❌ |
| `chainweb_principal_namespace` | Compute `n_<40hex>` principal namespace name from a keyset | ✅ | ❌ |
| `chainweb_deploy_module` | Build UNSCOPED-signer module deploy (+ create-table same tx), preflight, optionally submit | ❌ | ✅ |
| `chainweb_continue_pact` | Build scoped-signer defpact continuation, preflight, optionally submit | ❌ | ✅ |
| `chainweb_spv_proof` | Fetch base64 SPV proof for a cross-chain tx (ready=false when pending) | ✅ | ❌ |

The server **never** accepts private keys. `chainweb_send`,
`chainweb_deploy_module`, and `chainweb_continue_pact` require signatures
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
- `testnet06`: `https://api.testnet.chainweb-community.org`
- `mainnet`: `https://api.chainweb-community.org`

## MCP Client Configuration

The server runs via `npx` — no install step required:

```json
{
  "mcpServers": {
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
