# Security — @pact-community/mcp-chainweb

## Threat model

The server is a privileged bridge between an LLM agent and a Kadena
Chainweb HTTP node. The agent cannot be trusted; the node is devnet
(disposable but on the local machine).

### Controls

1. **Profile-gated runtime.** `PACT_COMMUNITY_CHAINWEB_MODE` and
   `PACT_COMMUNITY_CHAINWEB_PROFILE` must both be one of
   `devnet` / `testnet06` / `mainnet`, and must match each other.
   Invalid or mismatched values exit 13 at startup.
2. **Origin allowlist.** `PACT_COMMUNITY_CHAINWEB_BASE_URL` must resolve to
   an origin in the hard-coded list for the selected profile.
   - `devnet`: `http://localhost:8081`, `:8082`, `:8083`
   - `testnet06`: `https://api.testnet.chainweb.com`
   - `mainnet`: `https://api.chainweb-community.org`
   Checked at startup and re-checked on every `fetch()` call (defence in
   depth — DNS rebind resistance).
3. **Network ID strict match.** `chainweb.info` refuses to return data
   if the node's `networkId` differs from the expected value (default
   `development`). Error message is sanitized.
4. **Preflight guard on send.** `chainweb.send` runs a full
   `/local?preflight=true` first. If preflight does not return
   `status: 'success'`, `/send` is never invoked.
5. **Never accepts private keys.** `chainweb.send` requires a pre-signed
   `{cmd, hash, sigs}` transaction. The server has no signing
   capability.
6. **Public-profile write blocking.** `chainweb.send`,
   `chainweb.deploy_module`, and `chainweb.continue_pact` throw
   `PROFILE_WRITE_BLOCKED` on `testnet06` and `mainnet`.
7. **Boundary unwrapping.** Pact `{int:N}` / `{decimal:"N.M"}` / `{time}`
   types are recursively unwrapped. Failure shapes are recursively
   sanitized via the mcp-shared allowlisted sanitizer.
8. **Env allowlist.** Only the documented variables reach the process.
   `process.env` is cleaned on startup via `validateEnv`.
9. **Workspace root refusal.** Refuses to start with
   `PACT_COMMUNITY_WORKSPACE_ROOT=/`.
10. **Audit log.** Every tool call records `{tool, inputHash, exitStatus,
   durationMs}` — no raw arguments.
11. **Tool-schema drift.** The server verifies `tools.lock.json` at
    startup and refuses to start if a tool schema has changed.

### Test-only escape hatch

`PACT_COMMUNITY_TEST_ALLOW_ORIGINS` is honored **only** when
`NODE_ENV === 'test'`. It extends the fetch allowlist to additional
origins so the integration test can target an in-process mock chainweb
bound to `127.0.0.1:{ephemeral}`. In production (`NODE_ENV !== 'test'`)
the variable is silently discarded.

## Out of scope

- Public profile writes. `testnet06` and `mainnet` are intentionally read-only.
- Key management. Use the Ledger signer or `@kadena/client` to sign.
- Multi-step cross-chain flows. Use `chainweb.send` + `chainweb.poll`
  composed by the caller.

## Reporting

Private security reports: contact the Pact Community maintainers.
