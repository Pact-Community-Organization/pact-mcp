# Security Policy - @pact-community/mcp-shared

## Overview

This package implements the shared pact-mcp security baseline controls (see the repository [SECURITY.md](../../SECURITY.md)).

## Threat Model

### Primary Threats

1. **Prompt Injection** - LLM attempts to escape security sandboxes
2. **Privilege Escalation** - Tool execution with unintended system access  
3. **Data Exfiltration** - Unauthorized access to sensitive files or networks
4. **Command Injection** - Shell metacharacters in process arguments

### Attack Vectors

- Malicious inputs containing `<IMPORTANT>`, `<system>`, `[INST]...[/INST]` tags
- Path traversal attempts: `../../../etc/passwd`
- Symlinks pointing outside workspace boundaries  
- Shell injection via process spawning: `; rm -rf /`
- Network requests to unauthorized origins
- Root privilege execution

## Security Controls

### ✅ Mandatory Baseline (the pact-mcp security baseline)

| Control | Implementation | Risk Mitigation |
|---------|---------------|-----------------|
| **Root Refusal** | `process.getuid() === 0` check → exit 13 | Prevents privilege escalation |
| **Audit Logging** | All tools logged to `~/.pact-community/mcp-audit.log` | Forensics and compliance |
| **Input Sanitization** | Strip injection markers from tool outputs | Prevents prompt injection |
| **Environment Allowlist** | Validate env vars against explicit allowlist | Limits information disclosure |
| **Tool Schema Lock** | SHA-256 verification via `tools.lock.json` | Detects supply chain attacks |
| **Network Allowlist** | Origin-based fetch restriction | Prevents data exfiltration |
| **Filesystem Guards** | Path traversal and symlink protection | Confines file access |
| **Safe Process Spawn** | Force `shell: false`, validate arguments | Blocks command injection |

### 🔍 Audit Log Format

```json
{
  "timestamp": "2026-04-21T10:30:45.123Z",
  "server": "mcp-shared",
  "tool": "tool-name",
  "inputHash": "sha256:abc123...",
  "exitStatus": 0,
  "durationMs": 1250
}
```

**Important**: Raw inputs are NEVER logged—only SHA-256 hashes for correlation.

### 🧹 Sanitization Patterns

Input sanitization removes these injection markers:

- `<IMPORTANT>...</IMPORTANT>` (case insensitive)
- `<system>...</system>` (case insensitive)  
- `[INST]...[/INST]`
- ``` `system` ``` code fences
- `<anthropic>`, `<claude>`, `<assistant>`, `<human>` tags
- `[SYSTEM]`, `[ASSISTANT]`, `[HUMAN]` brackets
- `<thinking>...</thinking>`
- HTML comments `<!-- ... -->`

### 🌐 Network Security

Allowlisted fetch wrapper validates origin exactly:

```typescript
// ✅ Allowed
await fetch('http://localhost:8081/api')  

// ❌ Blocked (subdomain attack)
await fetch('http://localhost.evil.com:8081/api')

// ❌ Blocked (path manipulation)  
await fetch('https://evil.com/localhost:8081/api')
```

### 📁 Filesystem Security

Path resolution protects against:

- **Path traversal**: `../../../etc/passwd` → blocked
- **Symlink escapes**: symlinks to `/etc/shadow` → blocked  
- **Directory validation**: validates parent dirs for non-existent files

### ⚡ Process Execution Security

Safe spawn controls:

- **Never shell**: `shell: false` always enforced
- **Argument validation**: All args must be strings
- **Metacharacter detection**: Blocks `;`, `&`, `|`, `` ` ``, `$`, `()`, `<>`, etc.
- **Root prevention**: Cannot spawn with `uid: 0`

## Usage Guidelines

### ✅ Secure Patterns

```typescript
// Proper server initialization
const server = startServer({
  name: 'my-server',
  version: '1.0.0',
  envAllowlist: ['NODE_ENV', 'API_KEY'], // Explicit allowlist
  envStrict: true // Reject unknown env vars
});

// Safe file operations  
const safePath = resolveInsideWorkspace('/workspace', userInput);
const content = fs.readFileSync(safePath, 'utf-8');

// Safe network requests
const allowlistedFetch = createAllowlistedFetch(['https://api.example.com']);
const response = await allowlistedFetch(userUrl);

// Safe process execution
const result = await spawnWithOutput('git', ['status', '--porcelain']);
```

### ❌ Unsafe Patterns

```typescript
// DON'T: Bypass security controls
process.getuid = () => 1000; // Mocking breaks root detection

// DON'T: Skip validation  
const unsafePath = path.join(workspace, userInput); // Path traversal risk
fs.readFileSync(unsafePath);

// DON'T: Use raw fetch
await fetch(userProvidedUrl); // No origin validation

// DON'T: Use shell spawning
spawn('sh', ['-c', userCommand], { shell: true }); // Command injection
```

## Vulnerability Reporting

Report security issues via:

1. **GitHub Issue** with `security` label
2. **Email**: security@pact-community.dev (if available)

Include:
- **Attack vector** description
- **Impact assessment**  
- **Proof of concept** (if safe)
- **Suggested mitigation**

## Compliance

This security model complies with:

- **OWASP Top 10** web application security
- **NIST Cybersecurity Framework** baseline controls
- **Pact Community Enterprise** multi-agent security requirements

## Security Testing

Run security tests:

```bash
# Unit tests including security scenarios
pnpm test

# Coverage report (≥90% functions required)
pnpm test --coverage

# Audit dependencies  
pnpm audit --audit-level=high
```

## Updates

Security patches are prioritized and released immediately. Monitor:

- GitHub security advisories
- CHANGELOG.md security entries
- Package version updates