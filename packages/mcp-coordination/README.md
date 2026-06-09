# @pact-community/mcp-coordination

MCP server for Pact Community multi-agent coordination. Exposes 10 file-backed
tools — task queue, mailbox, per-agent status, and append-only memory log —
under a single workspace-scoped coordination root.

No network I/O. No subprocess spawn. All persistence lives under a
validated directory pinned by `SMARTPACTS_COORDINATION_ROOT`.

## Tools

| Tool                     | Purpose                                     |
|--------------------------|---------------------------------------------|
| `coord.task_create`      | Create a task.                              |
| `coord.task_list`        | List task summaries (optional filters).     |
| `coord.task_get`         | Read a single task by id.                   |
| `coord.task_update`      | Atomically update a task under file lock.   |
| `coord.task_complete`    | Mark done + verify artifact paths exist.    |
| `coord.mailbox_send`     | Append a message to an agent inbox.         |
| `coord.mailbox_read`     | Read inbox (non-mutating).                  |
| `coord.mailbox_ack`      | Set `readAt` on selected messages.          |
| `coord.status_set`       | Write agent status (idle/working/...).      |
| `coord.memory_append`    | Append an entry to a scoped memory log.     |

## Environment

| Var                               | Required | Description                                 |
|-----------------------------------|----------|---------------------------------------------|
| `SMARTPACTS_WORKSPACE_ROOT`       | yes      | Absolute workspace root.                    |
| `SMARTPACTS_COORDINATION_ROOT`    | no       | Defaults to `$WORKSPACE_ROOT/coordination`. |
| `SMARTPACTS_TOOLS_LOCKFILE`       | no       | Defaults to `./tools.lock.json`.            |

## Layout (under the coordination root)

```
tasks/<taskId>.json
mailboxes/<agent>/inbox.jsonl
status/<agent>.json
memory/<scope>.jsonl
```

## License

MIT
