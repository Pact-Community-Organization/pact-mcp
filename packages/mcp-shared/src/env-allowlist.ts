/**
 * @fileoverview Environment variable allowlist validation
 * @description Implements the pact-mcp security baseline environment security controls
 */

import { createAuditLogger } from './audit-log.js';

/**
 * Environment validation options
 */
export interface EnvValidationOptions {
  /** List of allowed environment variable names */
  allowed: string[];
  /** Whether to reject unknown env vars (true) or just log them (false) */
  strict: boolean;
}

/**
 * Environment validation result
 */
export interface ValidatedEnv {
  /** Sanitized environment object with only allowed variables */
  env: Record<string, string>;
  /** Names of rejected variables (in strict mode) */
  rejected: string[];
  /** Names of unknown variables (in permissive mode) */
  unknown: string[];
}

/**
 * Validate environment variables against allowlist
 * 
 * Security controls:
 * - Strict mode: rejects unknown env vars
 * - Permissive mode: logs unknown env vars to audit
 * - Always returns sanitized env object
 * 
 * @param options Validation configuration
 * @returns Validated environment and rejection info
 */
export function validateEnv(options: EnvValidationOptions): ValidatedEnv {
  const { allowed, strict } = options;
  const result: ValidatedEnv = {
    env: {},
    rejected: [],
    unknown: []
  };

  // Create audit logger for env validation events
  const auditLogger = createAuditLogger('env-validator');

  // Always allow core Node.js environment variables
  const coreEnvVars = [
    'NODE_ENV',
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'LANG',
    'LC_ALL',
    'TZ',
    'PWD',
    'TMPDIR'
  ];

  const fullAllowlist = [...allowed, ...coreEnvVars];

  // Process each environment variable
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;

    if (fullAllowlist.includes(key)) {
      // Allowed variable - include in sanitized env
      result.env[key] = value;
    } else {
      // Unknown variable - handle based on strictness
      if (strict) {
        result.rejected.push(key);
        
        // Log rejection to audit
        auditLogger.log({
          tool: 'env-validation',
          inputHash: `rejected:${key}`,
          exitStatus: 'ENV_VAR_REJECTED',
          durationMs: 0
        });
      } else {
        result.unknown.push(key);
        result.env[key] = value; // Include in permissive mode
        
        // Log unknown var to audit
        auditLogger.log({
          tool: 'env-validation',
          inputHash: `unknown:${key}`,
          exitStatus: 'ENV_VAR_UNKNOWN',
          durationMs: 0
        });
      }
    }
  }

  // In strict mode, exit on rejected variables
  if (strict && result.rejected.length > 0) {
    console.error(
      `[MCP-SECURITY] Rejected environment variables in strict mode: ${result.rejected.join(', ')}`
    );
    process.exit(13);
  }

  return result;
}