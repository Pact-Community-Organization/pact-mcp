# Security Policy

## Threat Model

Pact Community MCP servers handle sensitive blockchain operations and must defend against:

### Primary Threats

1. **Prompt Injection** - Malicious LLM inputs attempting to escape sandboxes
2. **Privilege Escalation** - Tool execution with unintended system access
3. **Data Exfiltration** - Unauthorized access to private keys, secrets, or sensitive data
4. **Supply Chain** - Compromised dependencies or tool schema drift

### Attack Vectors

- **Prompt injection markers**: `<IMPORTANT>`, `<system>`, `[INST]...[/INST]`, system code fences
- **Path traversal**: `../../../etc/passwd`, symlinks outside workspace
- **Command injection**: Shell metacharacters in spawn arguments
- **Network access**: Unauthorized HTTP requests to internal/external services
- **Root execution**: MCP server running with elevated privileges

## Security Baseline (ADR-MCP-001)

Every MCP server MUST implement:

### ✅ Mandatory Controls

- [ ] **Root refusal**: Exit 13 if `process.getuid() === 0`
- [ ] **Audit logging**: All tool invocations logged to `~/.pact-community/mcp-audit.log.YYYY-MM-DD`
- [ ] **Input sanitization**: Strip prompt injection markers from tool outputs
- [ ] **Environment allowlist**: Validate and restrict environment variables
- [ ] **Tool schema verification**: Detect drift via `tools.lock.json` SHA-256 hashes
- [ ] **Network allowlist**: Restrict HTTP requests to approved origins only
- [ ] **Filesystem boundaries**: Prevent path traversal and symlink escapes
- [ ] **Safe process spawning**: Never use `shell: true`, validate all arguments

### 📊 Audit Format

Each audit entry contains:
- ISO timestamp
- Server name
- Tool name
- SHA-256 hash of input JSON (NOT raw input)
- Exit status
- Duration (ms)

### 🔧 Tool Schema Locking

`tools.lock.json` format:
```json
{
  "version": 1,
  "servers": {
    "server-name": {
      "tool-name": {
        "schema": "...",
        "hash": "sha256:..."
      }
    }
  }
}
```

## Reporting Security Issues

Report security vulnerabilities to the Security agent via GitHub issue with label `security`.

Include:
1. **Attack vector** description
2. **Impact assessment** (data exposure, privilege escalation, etc.)
3. **Proof of concept** (if safe to share)
4. **Suggested mitigation**

## Compliance

This security model complies with:
- **OWASP Top 10** for web applications
- **NIST Cybersecurity Framework** baseline controls
- **Pact Community Enterprise** multi-agent security requirements