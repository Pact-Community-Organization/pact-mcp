# Changelog

All notable changes to Pact Community MCP servers will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **BREAKING** — every tool is renamed from `<server>.<tool>` to `<server>_<tool>`
  (`pact.repl_run` -> `pact_repl_run`, `chainweb.local` -> `chainweb_local`, and so on
  across all 33 tools). The Anthropic API requires tool names to match
  `^[a-zA-Z0-9_-]{1,64}$`, which excludes `.`; a client forwarding the old definitions
  had its request rejected, so **no tool of the server loaded at all**. Clients discover
  tools dynamically and need no configuration change, but any saved prompt or script that
  names a tool explicitly must be updated. (#50)

### Fixed
- `mcp-pact`: the `pact` subprocess is now guaranteed a UTF-8 locale. MCP clients commonly
  launch servers with a minimal environment where `LANG`/`LC_ALL` are unset, leaving the
  GHC-compiled `pact` binary in the C locale — one non-ASCII byte in a `.pact`/`.repl` file
  then aborted the whole load with `hGetContents: invalid argument`. A locale the caller
  already set to UTF-8 is honoured; anything else is replaced with `C.UTF-8`. (#51)
- `mcp-chainweb` (0.3.1): six of the eleven tools failed against every real node —
  devnet included — while the test suite was green, because the test mock answered in a
  shape no node uses. All measured against chainweb-node 3.2 (mainnet01 and a local
  devnet):
  - `/local?preflight=true` answers `{ preflightResult, preflightWarnings }`, not the bare
    command result. The parser read `result` off the top level, so `chainweb_send`
    refused every transaction (`PREFLIGHT_FAILED`, status `undefined`) and
    `chainweb_deploy_module` / `chainweb_continue_pact` reported every preflight as
    failed with an empty error. One shared parser now handles both shapes.
  - An unsigned transaction that names a signer was posted with `sigs: [null]`, which a
    node rejects with HTTP 400. Missing signatures are now sent as absent.
  - `chainweb_read_table` and `chainweb_principal_namespace` asked for a full preflight,
    which makes the node buy gas from the default sender and fail with
    `Failed to buy gas: Keyset failure`. Reads are now evaluate-only, as `chainweb_keys`
    already was.
  - `chainweb_local` defaulted to `preflight=true` and failed the same way; the default is
    now `false` (evaluate only). `preflight: true` is still available for simulating a
    full transaction and needs an existing `sender` whose key is in `signers`; its node
    warnings are returned as `warnings`.
  - `chainweb_info` compared the node against the hard-coded network id `development`
    and so refused on `testnet06`, on `mainnet`, and on any devnet configured through
    `PACT_COMMUNITY_CHAINWEB_NETWORK_ID`. It now checks the configured network id. Its
    `nodeVersion` returned the network id a second time and now returns the node
    software version; `chainHeights` (latest block height per chain) is new, since a
    3.2 node's `/cut` carries no block times and `chainTimestamps` is empty there.
  - `chainweb_send` now includes the node's own error in `PREFLIGHT_FAILED`.
  - The test mock now applies the preflight envelope and rejects null signatures as a
    node does, and the parser is pinned by response bodies captured from mainnet01.
- `mcp-chainweb` (0.2.3): `testnet06` default endpoint updated to `api.testnet.chainweb-community.org` (old `api.testnet.chainweb.com` deprecated).

### Added
- `mcp-shared`: `verifyToolsLock` now rejects any tool name outside
  `^[a-zA-Z0-9_-]{1,64}$` at server startup with `TOOL_NAME_INVALID`, so an invalid name
  fails loudly instead of silently producing a server with no usable tools.

### Changed
- Curated the published surface for community launch: `mcp-pact` and
  `mcp-chainweb` (plus the `mcp-shared` library) are the supported public
  packages, bumped to 0.2.2 with MCP-registry listing metadata (title,
  website). `mcp-devnet` and `mcp-coordination` are now internal, unpublished
  workspace tools — withdrawn from npm and the MCP registry, still built and
  tested in CI.

### Fixed
- Lock steal race in `mcp-coordination` that could delete a live lock mid-write
  (empty/malformed lock payloads are no longer treated as epoch-stale)
- Servers now start from any working directory: each package ships its own
  `tools.lock.json` and resolves it relative to the installed module
- Dependency audit is clean again (hono, ws, qs patch bumps)
- Dependabot no longer watches non-existent packages

### Changed
- License unified to Apache-2.0 across all manifests (LICENSE was already Apache-2.0)
- Packages now target the public npm registry and include `mcpName` +
  `server.json` manifests for the MCP registry
- `.mcp.json` rewritten in the standard `mcpServers` client format
- CI: coverage lane serialized, lockfile drift now actually regenerates and
  diffs, no-op lint job removed, Node 24 added to the build matrix

### Added
- Initial monorepo scaffold
- `@pact-community/mcp-shared` package with security baseline
- Shared security baseline controls implementation

### Security
- Audit logging system for all tool invocations
- Input sanitization to prevent prompt injection
- Tool schema drift detection via `tools.lock.json`
- Network and filesystem access controls

## [1.0.0] - 2026-04-21

### Added
- MCP monorepo foundation
- Security baseline implementation
- Documentation and CI/CD pipeline

[Unreleased]: https://github.com/Pact-Community-Organization/pact-mcp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Pact-Community-Organization/pact-mcp/releases/tag/v1.0.0