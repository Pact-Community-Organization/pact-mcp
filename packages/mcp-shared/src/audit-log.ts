/**
 * @fileoverview Append-only audit logger for MCP tool executions
 * @author Developer
 * @description Implements ADR-MCP-001 audit logging requirements
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Audit log entry structure
 */
export interface AuditLogEntry {
  tool: string;
  inputHash: string;
  exitStatus: string | number;
  durationMs: number;
}

/**
 * Audit logger interface
 */
export interface AuditLogger {
  log(entry: AuditLogEntry): void;
  getLogPath(): string;
}

/**
 * [Developer] Create audit logger for MCP server
 * 
 * Logs to ~/.pact-community/mcp-audit.log.YYYY-MM-DD with:
 * - ISO timestamp
 * - Server name  
 * - Tool name
 * - SHA-256 hash of input (NEVER raw inputs)
 * - Exit status
 * - Duration in milliseconds
 * 
 * @param serverName Name of the MCP server
 * @returns Audit logger instance
 */
export function createAuditLogger(serverName: string): AuditLogger {
  const auditDir = path.join(os.homedir(), '.pact-community');
  
  // [Developer] Ensure audit directory exists
  if (!fs.existsSync(auditDir)) {
    fs.mkdirSync(auditDir, { recursive: true, mode: 0o700 });
  }

  return {
    log(entry: AuditLogEntry): void {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const logPath = path.join(auditDir, `mcp-audit.log.${today}`);
      
      const logEntry = {
        timestamp: new Date().toISOString(),
        server: serverName,
        tool: entry.tool,
        inputHash: entry.inputHash,
        exitStatus: entry.exitStatus,
        durationMs: entry.durationMs
      };

      const logLine = JSON.stringify(logEntry) + '\n';

      // [Developer] Append-only with O_APPEND|O_CREAT flags for safety
      try {
        fs.writeFileSync(logPath, logLine, { 
          flag: 'a',
          mode: 0o600 // Owner read/write only
        });
      } catch (error) {
        // [Developer] Log to stderr but don't crash the server
        console.error(`[MCP-AUDIT] Failed to write audit log: ${error}`);
      }
    },

    getLogPath(): string {
      const today = new Date().toISOString().split('T')[0];
      return path.join(auditDir, `mcp-audit.log.${today}`);
    }
  };
}