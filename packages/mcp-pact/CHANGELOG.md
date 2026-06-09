# Changelog

All notable changes to `@pact-community/mcp-pact` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-04-22

### Added
- Tool: `pact.repl_run_many` — run a batch of .repl files sequentially with per-file and total-budget timeouts, optional `failFast`.
- Tool: `pact.gas_estimate` — parse `gas-probe: LABEL = N`, `LABEL: Gas: N`, and bare `Gas: N` emissions from a .repl run; read-only, does not inject probes.
- Tool: `pact.interface_diff` — compare the public API surface (module, implements, defun, defcap, defpact, defschema, deftable) of two .pact files; reports `added`, `removed`, `changed`, `unchanged`, and a `breakingChange` flag.
- Tool: `pact.fmt_check` — read-only formatting check (trailing whitespace, tabs, excess blank lines, missing trailing newline, CRLF). Never writes files.
- Analysis module `src/analysis/interface.ts` — lightweight balanced-paren extractor used by `interface_diff`.

### Security
- All four new tools enforce workspace-root containment via `resolveInsideWorkspace` (realpath + prefix check).
- `pact.interface_diff` enforces a 2 MB per-file source cap (same policy as `pact.module_scan`).
- `pact.repl_run_many` validates every path in the input array BEFORE spawning any `pact` process; refuses on first invalid path.
- `pact.fmt_check` performs only `readFileSync` — verified by a dedicated test that spies on every write-class `fs` API.
- Per-file stdout is sanitized and capped at 200 KB for `repl_run_many`.
- Added `tools.lock.json` entries and schema drift detection for all 6 tools.

## [0.1.0] - 2026-04-21

### Added
- Initial implementation of MCP Pact server.
- Tool: `pact.repl_run` — run a single .repl file against the pact binary.
- Tool: `pact.module_scan` — static analysis for Pact 5 critical traps.
- Resource: `pact://traps` — Pact 5 critical traps catalog (5 traps).

### Security
- Environment variable allowlist enforced.
- Path traversal protection with symlink resolution.
- No network access permitted.
- Audit logging of all tool calls.
- Shell injection prevention for process spawning.
- 200 KB output size cap prevents log bombs.
- Output sanitization prevents prompt injection.