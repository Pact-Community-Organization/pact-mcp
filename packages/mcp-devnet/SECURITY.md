# Security Model — `@pact-community/mcp-devnet`

## Threat surface

Wrapping `docker compose` as an MCP tool surfaces three attack classes:

1. **Command injection** — an MCP client supplies crafted `agent`, `service`,
   or `since` values that end up on a shell.
2. **Filesystem escape** — a compose path that resolves outside the
   workspace, or a `service` name containing path separators, could cause
   a host-side read outside the intended boundary.
3. **Privilege abuse** — an MCP client invokes `devnet.reset` and destroys
   named volumes the user did not mean to lose.

All three classes are addressed by layered controls — no single control
is load-bearing.

## Controls

| Control | File | Notes |
| --- | --- | --- |
| Root refusal | `src/server.ts :: resolveConfig` | exits via `REFUSE_ROOT` if `getuid() === 0` |
| Env allowlist (the pact-mcp security baseline §4) | `src/server.ts :: ALLOWED_ENV` | `validateEnv({strict:false})` — rejects unknown `PACT_COMMUNITY_*` |
| Mode assertion | `src/server.ts` | `PACT_COMMUNITY_DEVNET_MODE !== 'devnet'` → `process.exit(13)` |
| Docker binary path | `src/server.ts :: resolveDockerBinary` | override must be absolute AND exist; PATH scan otherwise |
| Compose file resolution | `src/docker/compose.ts :: resolveComposeFile` | uses `resolveInsideWorkspace` (symlink escape protected) |
| Compose content validation | `src/docker/compose.ts :: validateComposeFileContent` | 32 KB read, requires `/^services\s*:\s*$/m`, rejects non-agent `container_name` values |
| Lifecycle gate | `src/gating.ts :: assertLifecycleAllowed` | throws `LIFECYCLE_FORBIDDEN` unless env flag `=true` |
| Volume-wipe gate | `src/gating.ts :: assertVolumeWipeAllowed` | throws `VOLUME_WIPE_FORBIDDEN` unless env flag `=true` |
| Shell-metachar scrubbing | `@pact-community/mcp-shared :: spawnSafe` | forces `shell:false`, rejects `; & \| \` $ ( ) < > { } [ ] ! ? * ~ #` in argv |
| Minimal child env | `src/server.ts :: CHILD_ENV_ALLOW` | `{PATH, HOME, DOCKER_HOST}` only — docker cannot leak PACT_COMMUNITY_* into containers |
| `service` regex | `src/tools/logs.ts` | `/^[a-z][a-z0-9-]{0,63}$/` — no `.`, no `/`, no special chars |
| `since` regex | `src/tools/logs.ts` | duration `/^[1-9][0-9]{0,4}[smhd]$/` OR ISO-8601 |
| Stream caps | `src/docker/spawn.ts :: STREAM_CAP_BYTES` | 1 MB per-stream, `truncated:true` on overflow |
| Timeout + SIGKILL | `src/docker/spawn.ts` | SIGTERM → 5 s grace → SIGKILL → 500 ms force-resolve |
| Output sanitization | `@pact-community/mcp-shared :: sanitizeToolOutput` | strips ANSI / control chars / secrets |
| Network allowlist | `src/server.ts` | `createAllowlistedFetch([http://localhost:8081/2/3])` only |
| DNS-rebind protection | `@pact-community/mcp-shared :: createAllowlistedFetch` | applies to `devnet.health` |
| Tool-schema drift | `src/server.ts :: verifyToolsLock` | mismatch vs `tools.lock.json` exits 13 |
| Audit log | `src/server.ts :: wrap` | every tool call: `{tool, inputHash, exitStatus, durationMs}` in `~/.pact-community/mcp-audit.log` |

## Defaults

Without any env flags, the server is **read-only**:

```
PACT_COMMUNITY_DEVNET_MODE=devnet
PACT_COMMUNITY_WORKSPACE_ROOT=/abs/path
```

Under this default, `devnet.up`, `devnet.down`, and `devnet.reset`
**refuse to execute**. Only `devnet.status`, `devnet.health`, and
`devnet.logs` will succeed.

## Opting into destructive operations

```bash
# Allow start/stop (no volume wipe).
PACT_COMMUNITY_DEVNET_ALLOW_LIFECYCLE=true

# Allow `down -v` and `reset` (DATA LOSS).
PACT_COMMUNITY_DEVNET_ALLOW_VOLUME_WIPE=true
```

These flags are read **every call** — they are not cached at startup.
Toggling them mid-session takes effect on the next invocation.

## Audit guarantees

Every successful or failed tool call writes exactly one entry to
`~/.pact-community/mcp-audit.log`, via the shared `createAuditLogger`. The entry
includes:

- `tool` — e.g. `devnet.up [DESTRUCTIVE agent=Developer]` for gated calls
- `inputHash` — first 32 chars of base64(JSON(args))
- `exitStatus` — `0` on success, error code (e.g. `LIFECYCLE_FORBIDDEN`) on failure
- `durationMs`

Audit log rotation, redaction, and integrity signing are handled by
`@pact-community/mcp-shared`.

## Error taxonomy

All fatal errors use `McpToolError` with a stable, frozen error code:

```
LIFECYCLE_FORBIDDEN        — runtime gate refused
VOLUME_WIPE_FORBIDDEN      — runtime gate refused
COMPOSE_FILE_MISSING       — agent compose file not present
COMPOSE_FILE_SUSPICIOUS    — preflight scan flagged foreign container_name
DOCKER_NOT_FOUND           — docker binary absent
SPAWN_TIMEOUT              — child exceeded timeout budget (retryable)
REFUSE_ROOT                — process running as uid 0
CONFIG_MISSING             — PACT_COMMUNITY_WORKSPACE_ROOT unset
CONFIG_INVALID             — PACT_COMMUNITY_WORKSPACE_ROOT not a directory
NETWORK_ALLOWLIST_VIOLATION — HTTP host not in allowlist
```
