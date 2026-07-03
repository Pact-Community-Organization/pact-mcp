# @pact-community/mcp-shared

**Shared security baseline and utilities for Pact Community MCP servers.**

This package implements the security controls that every pact-mcp server shares (see the repository [SECURITY.md](../../SECURITY.md) for the full baseline).

## Features

- ✅ **Root refusal** - Prevents execution as root user
- ✅ **Audit logging** - All tool invocations logged with SHA-256 input hashing  
- ✅ **Input sanitization** - Removes prompt injection markers from outputs
- ✅ **Tool schema verification** - Detects schema drift via `tools.lock.json`
- ✅ **Environment allowlist** - Validates and restricts environment variables
- ✅ **Network controls** - Allowlisted fetch wrapper prevents unauthorized requests
- ✅ **Filesystem guards** - Prevents path traversal and symlink escapes
- ✅ **Safe process spawning** - Blocks shell injection and validates arguments
- ✅ **Structured errors** - Type-safe error handling with sanitization support

## Quick Start

```typescript
import { startServer } from '@pact-community/mcp-shared';

// Create MCP server with security baseline
const server = startServer({
  name: 'my-mcp-server',
  version: '1.0.0',
  envAllowlist: ['NODE_ENV', 'API_KEY'],
  envStrict: true
});

// Server automatically includes:
// - Root refusal check
// - Audit logging setup
// - Environment validation
// - Output sanitization
```

## Security Controls

### Audit Logging

All tool executions are logged to `~/.pact-community/mcp-audit.log.YYYY-MM-DD`:

```typescript
import { createAuditLogger } from '@pact-community/mcp-shared';

const logger = createAuditLogger('my-server');
logger.log({
  tool: 'deploy-module',
  inputHash: 'sha256:abc123...',
  exitStatus: 0,
  durationMs: 1250
});
```

### Input Sanitization

```typescript
import { sanitizeToolOutput } from '@pact-community/mcp-shared';

const result = sanitizeToolOutput(toolOutput);
console.log(result.text); // Sanitized output
console.log(result.modified); // Whether changes were made
```

### Network Security

```typescript
import { createAllowlistedFetch } from '@pact-community/mcp-shared';

const allowlistedFetch = createAllowlistedFetch([
  'http://localhost:8081',
  'https://api.chainweb-community.org'
]);

// Only allowed origins can be accessed
await allowlistedFetch('http://localhost:8081/api/data');
```

### Filesystem Guards

```typescript
import { resolveInsideWorkspace, safeTempDir } from '@pact-community/mcp-shared';

// Prevent path traversal
const safePath = resolveInsideWorkspace('/workspace', userPath);

// Create secure temp directory  
const tempDir = safeTempDir('my-prefix');
```

### Safe Process Execution

```typescript
import { spawnSafe, spawnWithOutput } from '@pact-community/mcp-shared';

// Secure process spawning (shell: false enforced)
const child = spawnSafe('pact', ['--version']);

// With output capture
const result = await spawnWithOutput('git', ['status', '--porcelain']);
console.log(result.stdout);
```

## Shared Schemas

Type-safe Zod schemas for Kadena blockchain data:

```typescript
import { ChainId, AccountName, PactDecimal, PublicKey } from '@pact-community/mcp-shared';

// Validate chain ID (0-19 for KDA-CE)
const chainId = ChainId.parse(5);

// Validate account name
const account = AccountName.parse('k:368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43cca');

// Validate decimal string
const amount = PactDecimal.parse('123.456');
```

## Error Handling

```typescript
import { McpToolError, createSecurityError } from '@pact-community/mcp-shared';

try {
  riskyOperation();
} catch (error) {
  if (error instanceof McpToolError) {
    if (error.retryable) {
      // Retry logic
    } else {
      // Log and fail
    }
  }
}
```

## Architecture

This package provides the foundation for all Pact Community MCP servers:

- **@pact-community/mcp-pact** - Pact smart contract tooling (REPL, scan, gas, diff, fmt)
- **@pact-community/mcp-chainweb** - Chainweb API and transaction tools
- **mcp-devnet** - Devnet docker lifecycle management *(internal, unpublished)*
- **mcp-coordination** - File-backed multi-agent coordination *(internal, unpublished)*

## Security

See [SECURITY.md](./SECURITY.md) for security controls and threat model.

## Requirements

- **Node.js** >=20.11.0
- **TypeScript** 5.6+  
- **Strict mode** required

## License

[Apache-2.0](../../LICENSE)
