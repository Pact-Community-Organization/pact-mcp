# @pact-community/mcp-devnet

Devnet Docker lifecycle MCP server.

Wraps `docker compose` for role-scoped KDA-CE devnets. Each role owns one
devnet stack; the compose file paths are fixed in the server (relative to the
workspace root) so tool input can never choose an arbitrary file:

| Role      | Port  | Compose file (under workspace root)            |
| --------- | ----- | ---------------------------------------------- |
| Developer | 8081  | `pact-examples/docker-compose.forge.yml`       |
| Tester    | 8082  | `pact-examples/docker-compose.tester.yml`      |
| Security  | 8083  | `pact-examples/docker-compose.security.yml`    |

## Tools

| Tool             | Annotation                       | Purpose                                                           |
| ---------------- | -------------------------------- | ----------------------------------------------------------------- |
| `devnet.status`  | `readOnlyHint=true`              | `docker compose ps` → structured container state                  |
| `devnet.health`  | `readOnlyHint=true`              | HTTP probe of `/info` + `/chainweb/0.0/{net}/cut` on the agent port |
| `devnet.logs`    | `readOnlyHint=true`              | Tail (up to 10k lines, capped at 1 MB)                            |
| `devnet.up`      | `destructiveHint=true` **GATED** | `docker compose up -d [--force-recreate]` — 120 s timeout         |
| `devnet.down`    | `destructiveHint=true` **GATED** | `docker compose down [-v]` — wipe requires extra flag             |
| `devnet.reset`   | `destructiveHint=true` **GATED** | `down -v` + `up --force-recreate` — full fresh devnet (DATA LOSS) |

## Gating

Read-only tools (`status`, `health`, `logs`) work out of the box. Mutating
tools refuse to execute unless the matching **runtime** env flag is set.

```bash
# Enable start/stop (no volume wipe)
export PACT_COMMUNITY_DEVNET_ALLOW_LIFECYCLE=true

# Enable `down -v` / `reset` (DATA LOSS)
export PACT_COMMUNITY_DEVNET_ALLOW_VOLUME_WIPE=true
```

`PACT_COMMUNITY_DEVNET_MODE=devnet` is a startup guard — the server refuses to
start unless this is set.

## Security controls

- All `docker` subprocesses use `spawnSafe` (rejects shell metachars).
- Child env is restricted to `{PATH, HOME, DOCKER_HOST}` only.
- Compose files are resolved via `resolveInsideWorkspace` (symlink-escape
  protected) and validated — a container_name like `production-*` will
  fail the preflight.
- `docker` binary path must be absolute if overridden
  (`PACT_COMMUNITY_DEVNET_DOCKER_BIN`); relative paths exit 13.
- HTTP probes restricted by `createAllowlistedFetch` to `http://localhost:{8081,8082,8083}`.
- stdout/stderr streams are capped at 1 MB and ANSI-sanitized before return.
- Every tool invocation writes an audit entry to
  `~/.pact-community/mcp-audit.log`; destructive tools include the agent in the
  record.

## Environment

| Variable                                | Purpose                                                          | Required      |
| --------------------------------------- | ---------------------------------------------------------------- | ------------- |
| `PACT_COMMUNITY_WORKSPACE_ROOT`             | Absolute path to the workspace containing the compose files     | yes           |
| `PACT_COMMUNITY_DEVNET_MODE`                | Must be `devnet`                                                 | yes           |
| `PACT_COMMUNITY_DEVNET_DOCKER_BIN`          | Override docker binary (absolute path)                           | no (auto on PATH) |
| `PACT_COMMUNITY_DEVNET_ALLOW_LIFECYCLE`     | Set to `true` to allow `up`/`down`/`reset`                       | no (read-only by default) |
| `PACT_COMMUNITY_DEVNET_ALLOW_VOLUME_WIPE`   | Set to `true` to allow `down -v` or `reset` (DATA LOSS)          | no            |
| `PACT_COMMUNITY_TOOLS_LOCKFILE`             | Override path to `tools.lock.json`                               | no            |

## Testing

```bash
pnpm --filter @pact-community/mcp-devnet test           # 91 tests
pnpm --filter @pact-community/mcp-devnet test:coverage  # funcs ≥90, lines ≥85, branches ≥80
```

## License

[Apache-2.0](../../LICENSE)
