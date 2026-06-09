# Security Model - @pact-community/mcp-pact

## Threat Model

This MCP server executes Pact REPL files and analyzes Pact source code. The primary threats are:

1. **Code Injection**: Malicious Pact code in REPL files
2. **Path Traversal**: Access files outside workspace  
3. **Resource Exhaustion**: Large outputs or infinite loops
4. **Shell Injection**: Command injection via subprocess
5. **Data Exfiltration**: Reading sensitive files

## Security Controls

### File System Access
- **Workspace Confinement**: All file operations restricted to `SMARTPACTS_WORKSPACE_ROOT`
- **Symlink Resolution**: Symbolic links resolved and validated before access
- **Path Traversal Protection**: `../` traversal attempts blocked
- **Read-Only Analysis**: Module scanning and diff tools never write files

### Process Execution  
- **Single Binary**: Only `pact` binary allowed for subprocess execution
- **No Shell Access**: `shell: false` enforced, no command interpretation
- **Argument Validation**: All arguments validated as strings, no shell metacharacters
- **Resource Limits**: 200KB stdout/stderr cap, 30s timeout per spawn

### Environment Variables
- **Allowlist**: Only `SMARTPACTS_WORKSPACE_ROOT`, `SMARTPACTS_PACT_BIN`, `PATH` accepted
- **Validation**: Environment variables sanitized and validated
- **No Secrets**: No credentials or sensitive data in environment

### Network Access
- **No Network**: Empty network allowlist - no `fetch` calls permitted
- **Local Only**: All operations strictly local to filesystem

### Output Sanitization
- **Prompt Injection Prevention**: All tool outputs sanitized to remove injection markers
- **Size Limits**: Output truncated at 200KB to prevent context flooding  
- **Encoding**: All outputs properly escaped for JSON transport

### Audit Trail
- **Tool Calls**: All invocations logged with input SHA-256 and results
- **Error Logging**: Security violations and errors logged with context
- **Monitoring**: Process execution times and resource usage tracked

## Assumptions

- **Trusted Workspace**: Files in `SMARTPACTS_WORKSPACE_ROOT` are trusted
- **Pact Binary**: The `pact` binary is trusted and properly installed
- **File Permissions**: OS-level file permissions properly configured
- **MCP Client**: The MCP client is trusted (Claude Desktop, etc.)

## Limitations

- **Pact Code Execution**: REPL files can contain arbitrary Pact code that executes in the Pact VM
- **Resource Usage**: Pact execution may consume significant CPU/memory
- **Error Messages**: Pact compilation errors may leak file structure information
- **Timing Attacks**: Execution time differences may leak information about file contents

## Incident Response

If a security issue is discovered:

1. **Immediate**: Stop the MCP server process
2. **Assessment**: Determine scope of potential compromise  
3. **Containment**: Isolate affected workspace
4. **Recovery**: Clean workspace and restart with updated controls
5. **Learning**: Update security controls based on findings

## Dependencies

This package inherits security controls from:
- `@pact-community/mcp-shared` - Baseline security framework
- `@modelcontextprotocol/sdk` - MCP protocol implementation
- Node.js built-in modules for file system and process spawning

## Contact

Security issues should be reported to the Pact Community security team via the main repository security policy.