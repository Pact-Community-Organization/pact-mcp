# @pact-community/mcp-chainweb

MCP server exposing eleven read/write Chainweb HTTP tools for the
Pact Community DAO devnet workflow.

**Status:** 0.2.0 — devnet-only

## Tools

| Name | Purpose | Read-only | Destructive |
|---|---|---|---|
| `chainweb.info` | Fetch `/info`, validate network ID, enumerate chain IDs | ✅ | ❌ |
| `chainweb.chain_time` | Current chain time in seconds for a given chain | ✅ | ❌ |
| `chainweb.local` | `/local?preflight=true` — simulate Pact code, unwrapped result | ✅ | ❌ |
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
| `PACT_COMMUNITY_CHAINWEB_MODE` | — | ✅ | Must be exactly `devnet` |
| `PACT_COMMUNITY_CHAINWEB_BASE_URL` | `http://localhost:8081` | | Origin must be in the devnet allowlist |
| `PACT_COMMUNITY_CHAINWEB_NETWORK_ID` | `development` | | Strictly validated against node `/info` |
| `PACT_COMMUNITY_TOOLS_LOCKFILE` | `./tools.lock.json` | | Used to detect tool-schema drift |

Production allowlist (hard-coded, not configurable):
`http://localhost:8081`, `http://localhost:8082`, `http://localhost:8083`.

## Quickstart

```bash
pnpm --filter @pact-community/mcp-chainweb build
node packages/mcp-chainweb/dist/bin.js  # stdio transport
```

Via the workspace `.mcp.json` entry:

```jsonc
"pact-community-chainweb": {
  "command": "node",
  "args": ["./packages/mcp-chainweb/dist/bin.js"],
  "env": {
    "NODE_ENV": "production",
    "PACT_COMMUNITY_WORKSPACE_ROOT": "<local-path>
    "PACT_COMMUNITY_CHAINWEB_MODE": "devnet",
    "PACT_COMMUNITY_CHAINWEB_BASE_URL": "http://localhost:8081",
    "PACT_COMMUNITY_CHAINWEB_NETWORK_ID": "development"
  }
}
```

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
