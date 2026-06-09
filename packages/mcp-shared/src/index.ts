/**
 * @fileoverview Pact Community MCP Shared - Security baseline for MCP servers
 * @author Developer
 * @description Implements ADR-MCP-001 security controls for all MCP servers
 */

// [Developer] Barrel exports for MCP shared utilities
export { startServer } from './server-baseline.js';
export { createAuditLogger } from './audit-log.js';
export { sanitizeToolOutput } from './sanitizer.js';
export { verifyToolsLock, generateToolsLockEntry } from './lockfile.js';
export { validateEnv } from './env-allowlist.js';
export { createAllowlistedFetch } from './network-allowlist.js';
export type { AllowlistedFetchOptions } from './network-allowlist.js';
export { resolveInsideWorkspace, safeTempDir } from './fs-guard.js';
export { spawnSafe, spawnWithOutput, McpSpawnError } from './spawn-guard.js';
export { McpToolError, ErrorCodes } from './errors.js';
export type { AuditLogger } from './audit-log.js';
export * from './schemas/index.js';