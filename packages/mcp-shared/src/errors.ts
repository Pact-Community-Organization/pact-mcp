/**
 * @fileoverview MCP error types and factories
 * @author Developer
 * @description Structured error handling for MCP security controls
 */

/**
 * [Developer] Base MCP tool error with structured metadata
 */
export class McpToolError extends Error {
  /** Error code for programmatic handling */
  public readonly code: string;
  
  /** Whether this error might be retryable */
  public readonly retryable: boolean;
  
  /** Whether error message has been sanitized */
  public readonly sanitized: boolean;
  
  /** Tool name that generated this error (if applicable) */
  public readonly toolName: string | undefined;

  constructor(
    code: string,
    message: string,
    retryable: boolean = false,
    toolName?: string
  ) {
    super(message);
    this.name = 'McpToolError';
    this.code = code;
    this.retryable = retryable;
    this.sanitized = false; // Default to unsanitized
    this.toolName = toolName;

    // [Developer] Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, McpToolError);
    }
  }

  /**
   * [Developer] Create sanitized copy of error (removes sensitive details)
   */
  sanitize(): McpToolError {
    const sanitized = new McpToolError(
      this.code,
      this.getSanitizedMessage(),
      this.retryable,
      this.toolName
    );
    
    // [Developer] Mark as sanitized
    (sanitized as any).sanitized = true;
    
    return sanitized;
  }

  /**
   * [Developer] Get sanitized error message
   */
  private getSanitizedMessage(): string {
    // [Developer] Remove potential path information
    let message = this.message
      .replace(/\/[^\s]+/g, '[PATH]') // Unix paths
      .replace(/[A-Za-z]:\\[^\s]+/g, '[PATH]') // Windows paths
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP]') // IP addresses
      .replace(/\b[a-f0-9]{8,}\b/gi, '[HASH]'); // Hashes (8+ chars)

    return `[${this.code}] ${message}`;
  }

  /**
   * [Developer] Custom JSON serialization to handle Error properties
   */
  toJSON() {
    const obj: any = {
      name: this.name,
      message: this.message,
      code: this.code,
      retryable: this.retryable,
      sanitized: this.sanitized
    };
    
    if (this.toolName !== undefined) {
      obj.toolName = this.toolName;
    }
    
    // [Developer] Handle circular references by omitting them
    return JSON.parse(JSON.stringify(obj, (key, value) => {
      // Skip circular references
      if (typeof value === 'object' && value !== null) {
        if (value === this) return '[Circular]';
      }
      return value;
    }));
  }
}

// [Developer] Error code constants for common scenarios (frozen for immutability)
export const ErrorCodes = Object.freeze({
  // Security violations
  ROOT_EXECUTION: 'ROOT_EXECUTION',
  FILE_OUTSIDE_WORKSPACE: 'FILE_OUTSIDE_WORKSPACE', 
  NETWORK_ALLOWLIST_VIOLATION: 'NETWORK_ALLOWLIST_VIOLATION',
  ENV_VAR_REJECTED: 'ENV_VAR_REJECTED',
  TOOL_SCHEMA_DRIFT: 'TOOL_SCHEMA_DRIFT',
  
  // Process execution
  SPAWN_FORBIDDEN_SHELL: 'SPAWN_FORBIDDEN_SHELL',
  SPAWN_INVALID_ARGS: 'SPAWN_INVALID_ARGS',
  SPAWN_ERROR: 'SPAWN_ERROR',
  
  // File operations
  FILE_PATH_INVALID: 'FILE_PATH_INVALID',
  FILE_RESOLUTION_ERROR: 'FILE_RESOLUTION_ERROR',
  TEMP_DIR_CREATE_FAILED: 'TEMP_DIR_CREATE_FAILED',
  
  // Network operations
  NETWORK_INVALID_INPUT: 'NETWORK_INVALID_INPUT',
  NETWORK_REQUEST_FAILED: 'NETWORK_REQUEST_FAILED',
  
  // Lockfile operations
  LOCKFILE_READ_ERROR: 'LOCKFILE_READ_ERROR',
  LOCKFILE_INVALID_FORMAT: 'LOCKFILE_INVALID_FORMAT',
  LOCKFILE_SERVER_NOT_FOUND: 'LOCKFILE_SERVER_NOT_FOUND',
  TOOL_NOT_LOCKED: 'TOOL_NOT_LOCKED',
  LOCKFILE_EXTRA_TOOL: 'LOCKFILE_EXTRA_TOOL',
  
  // Environment validation
  ENV_VAR_UNKNOWN: 'ENV_VAR_UNKNOWN',
  
  // Generic errors
  INVALID_INPUT: 'INVALID_INPUT',
  OPERATION_FAILED: 'OPERATION_FAILED',
  CORRUPT_STATE: 'CORRUPT_STATE',

  // Coordination server errors (added for @pact-community/mcp-coordination)
  NOT_FOUND: 'NOT_FOUND',
  LOCK_HELD: 'LOCK_HELD',
  ARTIFACT_NOT_FOUND: 'ARTIFACT_NOT_FOUND',
  UNKNOWN_AGENT: 'UNKNOWN_AGENT',
  COORD_ROOT_INVALID: 'COORD_ROOT_INVALID',

  // Devnet server errors (added for @pact-community/mcp-devnet)
  LIFECYCLE_FORBIDDEN: 'LIFECYCLE_FORBIDDEN',
  VOLUME_WIPE_FORBIDDEN: 'VOLUME_WIPE_FORBIDDEN',
  COMPOSE_FILE_MISSING: 'COMPOSE_FILE_MISSING',
  COMPOSE_FILE_SUSPICIOUS: 'COMPOSE_FILE_SUSPICIOUS',
  DOCKER_NOT_FOUND: 'DOCKER_NOT_FOUND',
  SPAWN_TIMEOUT: 'SPAWN_TIMEOUT'
} as const);

// [Developer] Factory functions for common errors

export function createSecurityError(code: string, message: string): McpToolError {
  return new McpToolError(code, message, false);
}

export function createRetryableError(code: string, message: string): McpToolError {
  return new McpToolError(code, message, true);
}

export function createValidationError(message: string): McpToolError {
  return new McpToolError(ErrorCodes.INVALID_INPUT, message, false);
}

export function createNetworkError(message: string, retryable: boolean = true): McpToolError {
  return new McpToolError(ErrorCodes.NETWORK_REQUEST_FAILED, message, retryable);
}

export function createFileSystemError(code: string, message: string): McpToolError {
  return new McpToolError(code, message, false);
}