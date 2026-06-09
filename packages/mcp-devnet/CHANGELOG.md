# Changelog — `@pact-community/mcp-devnet`

All notable changes to this package.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
SemVer 2.0.0.

## [0.1.0] — initial release

### Added

- `devnet.status` — `docker compose ps` reader with overall state
  classification (`up`/`degraded`/`down`/`missing`).
- `devnet.health` — HTTP probe of `/info` + `/chainweb/0.0/{net}/cut`
  with `genesisCaughtUp` heuristic (wall-time vs cut `creationTime`,
  600 s tolerance).
- `devnet.logs` — tail reader capped at 10 000 lines / 1 MB with
  service-name + since-spec validation.
- `devnet.up` — **GATED** `docker compose up -d [--force-recreate]`,
  120 s timeout, returns status snapshot.
- `devnet.down` — **GATED** `docker compose down [-v]`; volume wipe
  behind a second env flag.
- `devnet.reset` — **GATED** `down -v` + `up --force-recreate` (DATA LOSS).
- Audit logging for every invocation (destructive calls annotated with
  agent name).
- Compose-file preflight scanning (symlink-escape protected, rejects
  unknown `container_name` values).
- Agent → port map (Developer 8081, Tester 8082, Security 8083) shared
  with the Pact Community devnet convention.
- 91 unit, security, and integration tests; coverage ≥91 % lines /
  ≥97 % functions / ≥81 % branches.
- `tools.lock.json` drift check for all 6 tool schemas.
