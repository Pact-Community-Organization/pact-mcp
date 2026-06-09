/**
 * @fileoverview Tool schema drift detection via tools.lock.json
 * @author Developer
 * @description Implements ADR-MCP-001 tool schema verification
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import { McpToolError } from './errors.js';

/**
 * Tool schema lock entry
 */
interface ToolLockEntry {
  schema: string;
  hash: string;
}

/**
 * Tools lockfile structure
 */
interface ToolsLock {
  version: number;
  servers: Record<string, Record<string, ToolLockEntry>>;
}

/**
 * [Developer] Verify tool schemas against tools.lock.json
 * 
 * Prevents tool schema drift by:
 * 1. Reading tools.lock.json
 * 2. Canonicalizing each tool schema (sorted keys, no whitespace) 
 * 3. Computing SHA-256 hash
 * 4. Comparing against locked hash
 * 
 * @param serverName Name of the server
 * @param registeredTools Tool registry with inputSchema objects
 * @param lockfilePath Path to tools.lock.json (default: ./tools.lock.json)
 * @throws McpToolError on schema drift or lockfile issues
 */
export function verifyToolsLock(
  serverName: string,
  registeredTools: Record<string, { inputSchema: object }>,
  lockfilePath = './tools.lock.json'
): void {
  let lockfile: ToolsLock;

  // [Developer] Read and parse lockfile
  try {
    const lockData = fs.readFileSync(lockfilePath, 'utf-8');
    lockfile = JSON.parse(lockData);
  } catch (error) {
    throw new McpToolError(
      'LOCKFILE_READ_ERROR',
      `Failed to read tools.lock.json: ${error}`,
      false
    );
  }

  // [Developer] Validate lockfile structure
  if (!lockfile.servers || typeof lockfile.servers !== 'object') {
    throw new McpToolError(
      'LOCKFILE_INVALID_FORMAT',
      'tools.lock.json missing or invalid servers object',
      false
    );
  }

  const serverLocks = lockfile.servers[serverName];
  if (!serverLocks) {
    throw new McpToolError(
      'LOCKFILE_SERVER_NOT_FOUND',
      `Server '${serverName}' not found in tools.lock.json`,
      false
    );
  }

  // [Developer] Verify each registered tool
  for (const [toolName, toolConfig] of Object.entries(registeredTools)) {
    const lockEntry = serverLocks[toolName];
    if (!lockEntry) {
      throw new McpToolError(
        'TOOL_NOT_LOCKED',
        `Tool '${toolName}' not found in lockfile for server '${serverName}'`,
        false
      );
    }

    // [Developer] Canonicalize current schema and compute hash
    const canonicalSchema = canonicalizeSchema(toolConfig.inputSchema);
    const currentHash = hashSchema(canonicalSchema);

    if (currentHash !== lockEntry.hash) {
      throw new McpToolError(
        'TOOL_SCHEMA_DRIFT',
        `Tool '${toolName}' schema hash mismatch. Expected: ${lockEntry.hash}, Got: ${currentHash}`,
        false
      );
    }
  }

  // [Developer] Check for extra tools in lockfile
  const lockedTools = Object.keys(serverLocks);
  const registeredToolNames = Object.keys(registeredTools);
  
  for (const lockedTool of lockedTools) {
    if (!registeredToolNames.includes(lockedTool)) {
      throw new McpToolError(
        'LOCKFILE_EXTRA_TOOL',
        `Tool '${lockedTool}' in lockfile but not registered in server '${serverName}'`,
        false
      );
    }
  }
}

/**
 * [Developer] Canonicalize tool schema for deterministic hashing
 * 
 * Sorts object keys recursively and removes whitespace to ensure
 * identical schemas produce identical hashes regardless of key order.
 */
function canonicalizeSchema(schema: any): string {
  if (schema === null || schema === undefined) {
    return 'null';
  }

  if (typeof schema !== 'object') {
    return JSON.stringify(schema);
  }

  if (Array.isArray(schema)) {
    return '[' + schema.map(canonicalizeSchema).join(',') + ']';
  }

  // [Developer] Sort object keys for deterministic ordering
  const sortedKeys = Object.keys(schema).sort();
  const pairs = sortedKeys.map(key => {
    const value = canonicalizeSchema(schema[key]);
    return `"${key}":${value}`;
  });

  return '{' + pairs.join(',') + '}';
}

/**
 * [Developer] Compute SHA-256 hash of canonicalized schema
 */
function hashSchema(canonicalSchema: string): string {
  return 'sha256:' + crypto
    .createHash('sha256')
    .update(canonicalSchema, 'utf-8')
    .digest('hex');
}

/**
 * [Developer] Generate tools.lock.json entry for a server
 * 
 * @param serverName Name of the server
 * @param tools Tool registry with inputSchema objects
 * @param serverVersion Server version
 * @param sdkVersion SDK version
 * @returns Lockfile entry object for the server
 */
export function generateToolsLockEntry(
  serverName: string, 
  tools: Record<string, { inputSchema: object }>,
  serverVersion: string,
  sdkVersion: string
): Record<string, any> {
  const toolEntries: Record<string, ToolLockEntry> = {};
  
  for (const [toolName, toolConfig] of Object.entries(tools)) {
    const canonicalSchema = canonicalizeSchema(toolConfig.inputSchema);
    const hash = hashSchema(canonicalSchema);
    
    toolEntries[toolName] = {
      schema: canonicalSchema,
      hash: hash
    };
  }
  
  return {
    [serverName]: {
      version: serverVersion,
      sdkVersion: sdkVersion,
      tools: toolEntries
    }
  };
}