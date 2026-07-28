/**
 * @fileoverview Pact Community MCP Shared - Security baseline for MCP servers
 * @description Implements the pact-mcp security baseline controls shared by all servers
 */

export { startServer } from './server-baseline.js';
export { createAuditLogger } from './audit-log.js';
export { sanitizeToolOutput } from './sanitizer.js';
export {
  verifyToolsLock,
  generateToolsLockEntry,
  resolveLockfilePath,
  TOOL_NAME_PATTERN
} from './lockfile.js';
export { validateEnv } from './env-allowlist.js';
export { createAllowlistedFetch } from './network-allowlist.js';
export type { AllowlistedFetchOptions } from './network-allowlist.js';
export { resolveInsideWorkspace, safeTempDir } from './fs-guard.js';
export { spawnSafe, spawnWithOutput, McpSpawnError } from './spawn-guard.js';
export { McpToolError, ErrorCodes } from './errors.js';
export type { AuditLogger } from './audit-log.js';
export * from './schemas/index.js';
