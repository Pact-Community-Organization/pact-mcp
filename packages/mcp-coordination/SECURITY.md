# Security — @pact-community/mcp-coordination

## Threat Model

### In scope
- **Prompt injection** in user-supplied string fields. Mitigation: all
  recipient-bound string fields are routed through `sanitizeToolOutput`
  from `@pact-community/mcp-shared` before leaving the server. Raw data is
  preserved on disk.
- **Path traversal** via `taskId`, `agent`, `scope`. Mitigation: strict
  segment regex (`/^[A-Za-z0-9._-]+$/`), rejection of `..`, `/`, `\`,
  `\0`, and leading `.`, plus a realpath-anchored "inside-root" check.
- **Symlink escape**: every resolved path is realpath'd and must remain
  a descendant of the coordination root (or workspace root for
  `task_complete` artifacts).
- **Concurrency / lost updates**: mutating task and mailbox operations
  acquire a cooperative `<path>.lock` file via `O_EXCL|O_CREAT`, with a
  30s stale-lock steal. JSONL append uses `O_APPEND` (no lock needed).
- **Oversize payloads**: body ≤ 131072 chars (mailbox), note ≤ 1000
  chars, memory content ≤ 8192 chars. Enforced at schema layer.
- **Corrupt persisted files**: malformed JSON / schema failures never
  crash `task_list` / `mailbox_read`; counted and skipped.

### Out of scope
- **Multi-host coordination**: tools assume a single-host filesystem.
  Locks are advisory and do not survive across NFS/SMB mounts.
- **Network transport hardening**: this server talks stdio only.
- **Encryption at rest**: callers must protect the coordination root
  via filesystem ACLs.

## Refusals

- Process exits 13 on startup if `PACT_COMMUNITY_WORKSPACE_ROOT` is missing
  or not absolute, or if the coordination root is not a directory, not
  absolute, or otherwise un-realpathable.
- Running as `uid 0` triggers `REFUSE_ROOT`.
