/**
 * @fileoverview MCP Server security baseline implementation
 * @author Developer
 * @description ADR-MCP-001 security controls applied in correct order
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import process from 'node:process';

import { createAuditLogger } from './audit-log.js';
import { validateEnv } from './env-allowlist.js';
import { verifyToolsLock } from './lockfile.js';
import { sanitizeToolOutput } from './sanitizer.js';
import { McpToolError } from './errors.js';

/**
 * Server baseline configuration options
 */
export interface ServerBaselineOptions {
  /** Server name for audit logging */
  name: string;
  /** Server version */
  version: string;
  /** Allowed environment variables */
  envAllowlist?: string[];
  /** Whether to run env validation in strict mode */
  envStrict?: boolean;
  /** Tool registry for schema verification */
  tools?: Record<string, any>;
  /** Path to tools.lock.json (default: ./tools.lock.json) */
  lockfilePath?: string;
}

/**
 * [Developer] Start MCP server with ADR-MCP-001 security baseline
 * 
 * Applies security controls in order:
 * 1. Root refusal check
 * 2. Audit log initialization  
 * 3. Environment variable validation
 * 4. Tool schema verification
 * 5. Output sanitization setup
 * 
 * @param opts Configuration options
 * @returns Configured Server instance ready for stdio transport
 */
export function startServer(opts: ServerBaselineOptions): Server {
  // [Developer] 1. Root refusal - exit immediately if running as root
  if (process.getuid && process.getuid() === 0) {
    console.error('[MCP-SECURITY] Refusing to run as root (uid 0). Run as non-privileged user.');
    process.exit(13);
  }

  // [Developer] 2. Initialize audit logging
  const auditLogger = createAuditLogger(opts.name);

  // [Developer] 3. Validate environment variables
  const env = validateEnv({
    allowed: opts.envAllowlist || [],
    strict: opts.envStrict ?? true
  });

  // [Developer] 4. Verify tool schema lockfile (if tools provided)
  if (opts.tools && Object.keys(opts.tools).length > 0) {
    verifyToolsLock(opts.name, opts.tools, opts.lockfilePath);
  }

  // [Developer] 5. Create server with baseline configuration
  const server = new Server({
    name: opts.name,
    version: opts.version
  }, {
    capabilities: {
      tools: {}
    }
  });

  // [Developer] Note: Tool execution wrapping will be implemented when
  // MCP SDK provides tool handling API. For Phase 1.1, server baseline
  // focuses on initialization security controls.
  
  // TODO: Implement tool execution wrapping in Phase 1.2 when servers register tools
  // const originalCallTool = server.callTool?.bind(server);
  // if (originalCallTool) {
  //   server.callTool = async (request: any) => {
  //     const startTime = Date.now();
  //     const inputHash = await hashInput(JSON.stringify(request));
  //     
  //     try {
  //       const result = await originalCallTool(request);
  //       
  //       // [Developer] Sanitize tool output to prevent prompt injection
  //       if (result.content) {
  //         result.content = result.content.map((item: any) => {
  //           if (item.type === 'text') {
  //             const sanitized = sanitizeToolOutput(item.text);
  //             return { ...item, text: sanitized.text };
  //           }
  //           return item;
  //         });
  //       }
  //
  //       // [Developer] Log successful execution
  //       auditLogger.log({
  //         tool: request.name,
  //         inputHash,
  //         exitStatus: 0,
  //         durationMs: Date.now() - startTime
  //       });
  //
  //       return result;
  //     } catch (error) {
  //       // [Developer] Log failed execution
  //       const exitStatus = error instanceof McpToolError ? error.code : 1;
  //       auditLogger.log({
  //         tool: request.name,
  //         inputHash,
  //         exitStatus: typeof exitStatus === 'string' ? exitStatus : 1,
  //         durationMs: Date.now() - startTime
  //       });
  //       
  //       throw error;
  //     }
  //   };
  // }

  return server;
}

/**
 * [Developer] Hash input for audit log (never store raw inputs)
 */
async function hashInput(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256:' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}