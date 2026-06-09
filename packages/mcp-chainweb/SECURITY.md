# Security — @pact-community/mcp-chainweb

## Threat model

The server is a privileged bridge between an LLM agent and a Kadena
Chainweb HTTP node. The agent cannot be trusted; the node is devnet
(disposable but on the local machine).

### Controls

1. **Devnet-only runtime.** `PACT_COMMUNITY_CHAINWEB_MODE` must equal
   `devnet`. Anything else exits 13 at startup.
2. **Origin allowlist.** `PACT_COMMUNITY_CHAINWEB_BASE_URL` must resolve to
   an origin in the hard-coded production list
   (`http://localhost:8081`, `:8082`, `:8083`). Checked at startup and
   re-checked on every `fetch()` call (defence in depth — DNS rebind
   resistance).
3. **Network ID strict match.** `chainweb.info` refuses to return data
   if the node's `networkId` differs from the expected value (default
   `development`). Error message is sanitized.
4. **Preflight guard on send.** `chainweb.send` runs a full
   `/local?preflight=true` first. If preflight does not return
   `status: 'success'`, `/send` is never invoked.
5. **Never accepts private keys.** `chainweb.send` requires a pre-signed
   `{cmd, hash, sigs}` transaction. The server has no signing
   capability.
6. **Boundary unwrapping.** Pact `{int:N}` / `{decimal:"N.M"}` / `{time}`
   types are recursively unwrapped. Failure shapes are recursively
   sanitized via the mcp-shared allowlisted sanitizer.
7. **Env allowlist.** Only the documented variables reach the process.
   `process.env` is cleaned on startup via `validateEnv`.
8. **Workspace root refusal.** Refuses to start with
   `PACT_COMMUNITY_WORKSPACE_ROOT=/`.
9. **Audit log.** Every tool call records `{tool, inputHash, exitStatus,
   durationMs}` — no raw arguments.
10. **Tool-schema drift.** The server verifies `tools.lock.json` at
    startup and refuses to start if a tool schema has changed.

### Test-only escape hatch

`PACT_COMMUNITY_TEST_ALLOW_ORIGINS` is honored **only** when
`NODE_ENV === 'test'`. It extends the fetch allowlist to additional
origins so the integration test can target an in-process mock chainweb
bound to `127.0.0.1:{ephemeral}`. In production (`NODE_ENV !== 'test'`)
the variable is silently discarded.

## Out of scope

- Mainnet / testnet. Phase 1.2b is explicitly devnet-only.
- Key management. Use the Ledger signer or `@kadena/client` to sign.
- Multi-step cross-chain flows. Use `chainweb.send` + `chainweb.poll`
  composed by the caller.

## Reporting

Private security reports: contact the Pact Community maintainers.
