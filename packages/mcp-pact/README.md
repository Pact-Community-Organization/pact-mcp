# @pact-community/mcp-pact

MCP server for Pact 5 smart contract tooling. Provides REPL testing, module scanning, gas analysis, and code quality tools for Kadena blockchain development.

## Features

- **REPL Testing**: Run `.repl` files and aggregate results
- **Module Scanning**: Static analysis for Pact 5 critical traps 
- **Gas Estimation**: Measure gas consumption of expressions
- **Interface Diff**: Compare function signatures across Pact files
- **Format Checking**: Basic code style validation

## Tools

| Tool | Purpose | Annotations |
|------|---------|-------------|
| `pact.repl_run` | Run single .repl file | readOnly:false, destructive:false, idempotent:true |
| `pact.repl_run_many` | Run a batch of .repl files sequentially | readOnly:false, destructive:false, idempotent:true |
| `pact.module_scan` | Static analysis for traps | readOnly:true, destructive:false, idempotent:true |
| `pact.gas_estimate` | Measure gas consumption | readOnly:true, destructive:false, idempotent:true |
| `pact.interface_diff` | Compare file signatures | readOnly:true, destructive:false, idempotent:true |
| `pact.fmt_check` | Check code formatting | readOnly:true, destructive:false, idempotent:true |

## Resources

- `pact://traps` — JSON catalog of Pact 5 critical traps (5 entries)

## Environment Variables

- `PACT_COMMUNITY_WORKSPACE_ROOT` (required): Workspace root directory
- `PACT_COMMUNITY_PACT_BIN` (optional): Path to pact binary (default: 'pact')

## Security

- File system access restricted to workspace root
- No network access allowed  
- Process spawning limited to pact binary only
- Output sanitization prevents prompt injection
- 200KB output size cap prevents log bombs

## Installation

```bash
pnpm install @pact-community/mcp-pact
```

## Usage

```bash
# As standalone server
pact-community-pact

# Via MCP client
npx @modelcontextprotocol/inspector pact-community-pact
```

## Examples

### Run REPL Test
```json
{
  "method": "tools/call",
  "params": {
    "name": "pact.repl_run",
    "arguments": {
      "file": "pact/tests/dao-token.repl"
    }
  }
}
```

### Run REPL Batch
```json
{
  "method": "tools/call",
  "params": {
    "name": "pact.repl_run_many",
    "arguments": {
      "files": [
        "pact/tests/dao-types.repl",
        "pact/tests/dao-token.repl",
        "pact/tests/dao-voting.repl"
      ],
      "failFast": false
    }
  }
}
```

Response shape:
```jsonc
{
  "results": [
    { "file": "…", "exitCode": 0, "ok": true, "stdout": "…", "stderr": "",
      "durationMs": 1234, "truncated": false }
  ],
  "summary": { "total": 3, "passed": 3, "failed": 0, "totalDurationMs": 3700 },
  "aborted": false,
  "timedOut": false
}
```

Notes:
- Validates every path BEFORE spawning any `pact` process (rejects on first bad path).
- Per-file timeout 60s, total budget 300s (overridable at server config time).
- `ok` = `exitCode === 0 && stdout contains "Load successful" && no "Load failed"`.

### Scan Module for Traps
```json
{
  "method": "tools/call",
  "params": {
    "name": "pact.module_scan",
    "arguments": {
      "file": "pact/modules/dao-token.pact"
    }
  }
}
```

### Estimate Gas

`pact.gas_estimate` is **read-only**: it does not inject gas probes. The `.repl`
file must emit gas using any of these forms:

- `(env-gaslimit N)` followed by `(env-gas 0) … (env-gas)` — prints `Gas: <n>`
- Labeled: `"label: Gas: <n>"`
- Harness form: `"gas-probe: LABEL = <n>"`

```json
{
  "method": "tools/call",
  "params": {
    "name": "pact.gas_estimate",
    "arguments": {
      "file": "pact/tests/gas/transfer.repl",
      "gasLimit": 150000
    }
  }
}
```

Response:
```jsonc
{
  "file": "…",
  "exitCode": 0,
  "measurements": [
    { "label": "transfer", "gas": 500, "lineNumber": 12 },
    { "gas": 700, "lineNumber": 15 }
  ],
  "totalGas": 1200,
  "warning": null,
  "truncated": false,
  "durationMs": 850
}
```

Emits `warning` when no probes are found — no false-positive zero measurements.

### Interface Diff
Compare the public-API surface (module, implements, defun, defcap, defpact,
defschema, deftable) of two `.pact` files. Useful in CI to detect breaking
changes before merge.

```json
{
  "method": "tools/call",
  "params": {
    "name": "pact.interface_diff",
    "arguments": {
      "before": "pact/modules/dao-token.pact",
      "after":  "pact/modules/dao-token.next.pact"
    }
  }
}
```

Response:
```jsonc
{
  "moduleName": { "before": "dao-token", "after": "dao-token" },
  "added":     [{ "kind": "defun", "name": "burn", "signature": "(defun burn …)", "line": 42 }],
  "removed":   [{ "kind": "defpact", "name": "cross-transfer", "signature": "…", "line": 88 }],
  "changed":   [{ "kind": "defun", "name": "transfer",
                  "before": { "signature": "(defun transfer (from to amount) …)", "line": 30 },
                  "after":  { "signature": "(defun transfer (from to amount memo) …)", "line": 30 } }],
  "unchanged": [/* … */],
  "breakingChange": true,
  "parseWarnings": []
}
```

`breakingChange` = `removed.length > 0 || changed.length > 0`. Each file is
capped at 2 MB; oversized inputs reject with `FILE_TOO_LARGE`. If neither file
yields any extractable symbols the tool throws `UNPARSEABLE_PACT`.

### Format Check
Read-only style check. Never writes files.

```json
{
  "method": "tools/call",
  "params": {
    "name": "pact.fmt_check",
    "arguments": {
      "files": [
        "pact/modules/dao-token.pact",
        "pact/modules/dao-voting.pact"
      ]
    }
  }
}
```

Issue kinds reported:
- `trailing-whitespace`
- `tab-character`
- `excess-blank-lines` (≥2 consecutive blank lines, reported once per run)
- `no-trailing-newline`
- `crlf-line-ending`

Response:
```jsonc
{
  "results": [
    { "file": "…", "clean": true,  "issues": [] },
    { "file": "…", "clean": false, "issues": [
        { "line": 12, "kind": "tab-character" },
        { "line": 30, "kind": "trailing-whitespace" }
    ]}
  ],
  "summary": { "total": 2, "clean": 1, "dirty": 1 }
}
```

## Security Model

See [SECURITY.md](./SECURITY.md) for threat model and security controls.

## License

MIT - see [LICENSE](../../LICENSE)