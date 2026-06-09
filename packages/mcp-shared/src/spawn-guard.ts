/**
 * @fileoverview Safe process spawning for MCP servers  
 * @author Developer
 * @description Implements ADR-MCP-001 process execution security controls
 */

import { spawn, type SpawnOptions, type ChildProcess } from 'node:child_process';
import { McpToolError } from './errors.js';

/**
 * [Developer] MCP spawn error for process execution failures
 */
export class McpSpawnError extends McpToolError {
  constructor(message: string, retryable: boolean = false) {
    super('SPAWN_ERROR', message, retryable);
  }
}

/**
 * Safe spawn options (subset of SpawnOptions with security restrictions)
 */
export interface SafeSpawnOptions {
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: NodeJS.ProcessEnv;
  /** stdio configuration */
  stdio?: 'pipe' | 'inherit' | 'ignore' | Array<'pipe' | 'inherit' | 'ignore' | number>;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Kill signal */
  killSignal?: NodeJS.Signals;
  /** Max buffer size for stdio */
  maxBuffer?: number;
  /** User ID (only allowed if not root) */
  uid?: number;
  /** Group ID */
  gid?: number;
}

/**
 * [Developer] Spawn process with security restrictions
 * 
 * Security controls:
 * - Forces shell: false to prevent command injection
 * - Validates argv is string[] to prevent object injection
 * - Rejects shell metacharacters in command/args
 * - Enforces argument type checking
 * 
 * @param command Command to execute (no shell interpretation)
 * @param argv Array of string arguments
 * @param options Safe spawn options
 * @returns ChildProcess instance
 * @throws McpSpawnError on security violations
 */
export function spawnSafe(
  command: string,
  argv: string[] = [],
  options: SafeSpawnOptions = {}
): ChildProcess {
  // [Developer] Validate command is string
  if (typeof command !== 'string') {
    throw new McpSpawnError('Command must be a string');
  }

  // [Developer] Validate argv is string array
  if (!Array.isArray(argv)) {
    throw new McpSpawnError('Arguments must be an array');
  }

  for (let i = 0; i < argv.length; i++) {
    if (typeof argv[i] !== 'string') {
      throw new McpSpawnError(`Argument at index ${i} must be a string, got ${typeof argv[i]}`);
    }
  }

  // [Developer] Check for shell metacharacters (defense in depth)
  const shellMetaChars = /[;&|`$()<>{}[\]!?*~#]/;
  if (shellMetaChars.test(command)) {
    throw new McpSpawnError(`Command contains shell metacharacters: ${command}`);
  }

  for (const arg of argv) {
    if (shellMetaChars.test(arg)) {
      throw new McpSpawnError(`Argument contains shell metacharacters: ${arg}`);
    }
  }

  // [Developer] Build secure spawn options
  const secureOptions: SpawnOptions = {
    ...options,
    shell: false, // NEVER allow shell interpretation
    detached: false // Keep process attached for proper cleanup
  };

  // [Developer] Additional validation for security-sensitive options
  if (secureOptions.uid === 0) {
    throw new McpSpawnError('Cannot spawn process as root (uid 0)');
  }

  try {
    return spawn(command, argv, secureOptions);
  } catch (error) {
    throw new McpSpawnError(
      `Process spawn failed: ${error}`,
      isRetryableSpawnError(error)
    );
  }
}

/**
 * [Developer] Check if spawn error might be retryable
 */
function isRetryableSpawnError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    const nodeError = error as NodeJS.ErrnoException;
    
    // [Developer] These errors might be temporary
    const retryableCodes = ['EAGAIN', 'EMFILE', 'ENFILE', 'ENOMEM'];
    return retryableCodes.includes(nodeError.code || '');
  }
  
  return false;
}

/**
 * [Developer] Spawn process and capture output
 * 
 * Convenience wrapper that captures stdout/stderr and waits for completion.
 * 
 * @param command Command to execute
 * @param argv Command arguments
 * @param options Spawn options
 * @returns Promise with exit code and output
 */
export async function spawnWithOutput(
  command: string,
  argv: string[] = [],
  options: SafeSpawnOptions = {}
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawnSafe(command, argv, {
      ...options,
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
    }

    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });

    child.on('error', (error) => {
      reject(new McpSpawnError(`Process error: ${error}`));
    });

    // [Developer] Handle timeout if specified
    if (options.timeout) {
      setTimeout(() => {
        if (!child.killed) {
          child.kill(options.killSignal || 'SIGTERM');
          reject(new McpSpawnError(`Process timeout after ${options.timeout}ms`));
        }
      }, options.timeout);
    }
  });
}