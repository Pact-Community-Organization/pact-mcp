# Changelog

All notable changes to `@pact-community/mcp-chainweb` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] — v0.2 tools

### Added
- `chainweb.read_table` — read a single Pact table row via `/local`
  (`(read module.table "key")`). Auto-unwraps Pact JSON types. Missing
  keys surface as `keyFound: false` (not an error). Keys are validated
  to reject `"` and `\\` at the zod layer to prevent Pact-source
  injection. 1 MB post-unwrap row cap.
- `chainweb.keys` — list row keys of a Pact table via
  `(take limit (keys module.table))`. Default limit 1000, max 10 000.
  Returns `hasMore` when count equals the limit.
- `chainweb.principal_namespace` — compute the deterministic
  `n_<40 lowercase hex>` principal namespace name from a keyset via
  `ns.create-principal-namespace`. Validates the response against
  `/^n_[a-f0-9]{40}$/` and throws `MALFORMED_PRINCIPAL` otherwise.
- `chainweb.deploy_module` — build an **UNSCOPED-signer** module-deploy
  tx with optional `create-table` calls appended in the SAME tx (memory
  lesson: separate `create-table` tx fails with "Module admin is
  necessary for operation"). Preflights via `/local`; submits to
  `/send` iff the caller supplies `sigs`. Without `sigs`, returns the
  unsigned envelope. 512 KB module-code cap; 64 KB envData cap. NEVER
  accepts private keys.
- `chainweb.continue_pact` — build a continuation tx (scoped signer,
  `coin.GAS` default) for a defpact step. Preflights via `/local` on
  the target chain; submits iff `sigs` is supplied. 2 MB proof cap;
  64 KB envData cap. Caller manages continuation transitive deps.
- `chainweb.spv_proof` — fetch the base64 SPV proof for a cross-chain
  request key from `/chain/<source>/pact/spv`. "Not ready" responses
  surface as `ready: false` (not an error). Rejects
  `sourceChainId === targetChainId` with `SPV_SAME_CHAIN`.

### Changed
- Server version bumped to `0.2.0`. Tool count: 5 → 11.
- `tools.lock.json` regenerated to include the 6 new entries. Existing
  5 MVP tool hashes unchanged.

## [0.1.0-MVP] — initial release

### Added
- `chainweb.info` — fetch `/info`, validate `networkId`, enumerate chain
  IDs, optional per-chain `chainTimestamps` via `/cut`.
- `chainweb.chain_time` — chain time in **seconds** (microsecond
  conversion) for a given chain, plus block height and block hash.
- `chainweb.local` — `/local?preflight=true` with full Pact JSON
  type-unwrapping on the result.
- `chainweb.send` — preflight-gated `/send`. Rejects the transaction
  (never POSTs) when preflight is not `status: 'success'`. Never
  accepts private keys.
- `chainweb.poll` — `/poll` loop (not `/listen`) with injectable `sleep`
  for test determinism and unwrapped results.
- Allowlisted fetch wrapper with hard-coded devnet origin list
  (`localhost:8081`, `:8082`, `:8083`).
- Strict env allowlist; workspace-root refusal; tool-schema lockfile
  verification at startup.
- Audit log of every call (`tool`, `inputHash`, `exitStatus`,
  `durationMs`).
- 69 unit + in-process tests and a full stdio integration test against
  a mock chainweb server. Coverage: statements 94 %, branches 80 %,
  functions 100 %.
