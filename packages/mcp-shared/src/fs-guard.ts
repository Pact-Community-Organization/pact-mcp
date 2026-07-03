/**
 * @fileoverview Filesystem access guards for MCP servers
 * @description Implements the pact-mcp security baseline filesystem security controls
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { McpToolError } from './errors.js';

/**
 * Resolve path inside workspace with security checks
 * 
 * Prevents:
 * - Path traversal attacks (../../../etc/passwd)
 * - Symlinks pointing outside workspace
 * - Access to files outside workspace root
 * 
 * @param workspaceRoot Absolute path to workspace root
 * @param userPath User-provided path (can be relative)
 * @returns Resolved absolute path inside workspace
 * @throws McpToolError if path escapes workspace
 */
export function resolveInsideWorkspace(workspaceRoot: string, userPath: string): string {
  try {
    // Resolve workspace root to canonical path
    const canonicalRoot = fs.realpathSync(workspaceRoot);
    
    // Join user path with workspace root
    const joinedPath = path.join(canonicalRoot, userPath);
    
    // Resolve to canonical path (follows symlinks)
    const canonicalPath = fs.realpathSync(joinedPath);
    
    // Check if resolved path is still inside workspace
    if (!canonicalPath.startsWith(canonicalRoot + path.sep) && canonicalPath !== canonicalRoot) {
      throw new McpToolError(
        'FILE_OUTSIDE_WORKSPACE',
        `Path '${userPath}' resolves outside workspace root '${workspaceRoot}'`,
        false
      );
    }
    
    return canonicalPath;
  } catch (error) {
    if (error instanceof McpToolError) {
      throw error;
    }
    
    // Handle ENOENT and other filesystem errors
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // For non-existent files, validate the directory part
      try {
        const dir = path.dirname(path.join(workspaceRoot, userPath));
        const canonicalRoot = fs.realpathSync(workspaceRoot);
        const canonicalDir = fs.realpathSync(dir);
        
        if (!canonicalDir.startsWith(canonicalRoot + path.sep) && canonicalDir !== canonicalRoot) {
          throw new McpToolError(
            'FILE_OUTSIDE_WORKSPACE',
            `Path '${userPath}' would resolve outside workspace root '${workspaceRoot}'`,
            false
          );
        }
        
        // Return the intended path (may not exist yet)
        return path.join(canonicalDir, path.basename(userPath));
      } catch {
        throw new McpToolError(
          'FILE_PATH_INVALID',
          `Cannot validate path '${userPath}': ${error}`,
          false
        );
      }
    }
    
    throw new McpToolError(
      'FILE_RESOLUTION_ERROR',
      `Path resolution failed for '${userPath}': ${error}`,
      false
    );
  }
}

/**
 * Create safe temporary directory
 * 
 * Creates uniquely named temp directory under os.tmpdir() with:
 * - Process ID to avoid conflicts
 * - Random suffix for additional uniqueness
 * - Restricted permissions (0o700)
 * 
 * @param prefix Prefix for temp directory name
 * @returns Absolute path to created temp directory
 */
export function safeTempDir(prefix: string = 'mcp'): string {
  const pid = process.pid;
  const random = crypto.randomBytes(8).toString('hex');
  const tempName = `pact-community-${prefix}-${pid}-${random}`;
  const tempPath = path.join(os.tmpdir(), tempName);
  
  try {
    fs.mkdirSync(tempPath, { mode: 0o700 }); // Owner only
    return tempPath;
  } catch (error) {
    throw new McpToolError(
      'TEMP_DIR_CREATE_FAILED',
      `Failed to create temp directory: ${error}`,
      false
    );
  }
}

/**
 * Check if path is inside workspace (without resolving)
 * 
 * Lightweight check for path validation without filesystem access.
 * Use resolveInsideWorkspace() for full security validation.
 * 
 * @param workspaceRoot Workspace root path
 * @param targetPath Path to check
 * @returns true if path appears to be inside workspace
 */
export function isPathInsideWorkspace(workspaceRoot: string, targetPath: string): boolean {
  try {
    // Normalize and ensure no trailing slash for consistent comparison
    const normalizedRoot = path.normalize(workspaceRoot).replace(/[/\\]+$/, '');
    const normalizedPath = path.normalize(path.isAbsolute(targetPath) 
      ? targetPath 
      : path.join(normalizedRoot, targetPath)
    );
    
    return normalizedPath.startsWith(normalizedRoot + path.sep) || normalizedPath === normalizedRoot;
  } catch {
    return false;
  }
}