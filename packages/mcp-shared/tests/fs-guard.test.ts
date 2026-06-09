/**
 * @fileoverview Tests for filesystem security guards
 * @author Developer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { 
  resolveInsideWorkspace, 
  safeTempDir, 
  isPathInsideWorkspace 
} from '../src/fs-guard.js';
import { McpToolError } from '../src/errors.js';

// [Developer] Mock filesystem modules
vi.mock('node:fs');
vi.mock('node:os');

const mockFs = vi.mocked(fs);
const mockOs = vi.mocked(os);

beforeEach(() => {
  vi.clearAllMocks();
  
  // [Developer] Default mocks for successful path resolution
  mockFs.realpathSync.mockImplementation((path) => {
    if (typeof path === 'string') {
      return path; // Return path as-is for simple tests
    }
    throw new Error('Invalid path type');
  });
  
  mockFs.mkdirSync.mockImplementation(() => {});
  mockOs.tmpdir.mockReturnValue('/tmp');
});

describe('fs-guard', () => {
  describe('resolveInsideWorkspace', () => {
    const workspaceRoot = '/workspace';

    beforeEach(() => {
      // [Developer] Mock realpathSync to return canonical paths
      mockFs.realpathSync.mockImplementation((inputPath) => {
        if (inputPath === workspaceRoot) {
          return workspaceRoot;
        }
        if (inputPath.toString().startsWith(workspaceRoot)) {
          return inputPath.toString();
        }
        return inputPath.toString();
      });
    });

    it('should allow paths inside workspace', () => {
      const result = resolveInsideWorkspace(workspaceRoot, 'subdir/file.txt');
      
      expect(result).toBe('/workspace/subdir/file.txt');
    });

    it('should allow paths at workspace root', () => {
      mockFs.realpathSync.mockImplementation((inputPath) => {
        if (inputPath === '/workspace/.' || inputPath === '/workspace') {
          return workspaceRoot;
        }
        return inputPath.toString();
      });

      const result = resolveInsideWorkspace(workspaceRoot, '.');
      
      expect(result).toBe(workspaceRoot);
    });

    it('should reject path traversal attacks', () => {
      mockFs.realpathSync.mockImplementation((inputPath) => {
        if (inputPath === workspaceRoot) {
          return workspaceRoot;
        }
        if (inputPath.toString().includes('../../')) {
          return '/etc/passwd'; // Simulated traversal result
        }
        return inputPath.toString();
      });

      expect(() => {
        resolveInsideWorkspace(workspaceRoot, '../../etc/passwd');
      }).toThrow(McpToolError);

      try {
        resolveInsideWorkspace(workspaceRoot, '../../etc/passwd');
      } catch (error) {
        expect((error as McpToolError).code).toBe('FILE_OUTSIDE_WORKSPACE');
      }
    });

    it('should reject symlinks pointing outside workspace', () => {
      mockFs.realpathSync.mockImplementation((inputPath) => {
        if (inputPath === workspaceRoot) {
          return workspaceRoot;
        }
        if (inputPath.toString().includes('symlink')) {
          return '/etc/shadow'; // Symlink target outside workspace
        }
        return inputPath.toString();
      });

      expect(() => {
        resolveInsideWorkspace(workspaceRoot, 'symlink');
      }).toThrow(McpToolError);

      try {
        resolveInsideWorkspace(workspaceRoot, 'symlink');
      } catch (error) {
        expect((error as McpToolError).code).toBe('FILE_OUTSIDE_WORKSPACE');
      }
    });

    it('should handle non-existent files by validating directory', () => {
      mockFs.realpathSync.mockImplementation((inputPath) => {
        if (inputPath === workspaceRoot) {
          return workspaceRoot;
        }
        if (inputPath.toString() === '/workspace/subdir/nonexistent.txt') {
          const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
          error.code = 'ENOENT';
          throw error;
        }
        if (inputPath.toString() === '/workspace/subdir') {
          return '/workspace/subdir';
        }
        return inputPath.toString();
      });

      const result = resolveInsideWorkspace(workspaceRoot, 'subdir/nonexistent.txt');
      
      expect(result).toBe('/workspace/subdir/nonexistent.txt');
    });

    it('should reject non-existent files with directories outside workspace', () => {
      mockFs.realpathSync.mockImplementation((inputPath) => {
        if (inputPath === workspaceRoot) {
          return workspaceRoot;
        }
        if (inputPath.toString().includes('nonexistent')) {
          const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
          error.code = 'ENOENT';
          throw error;
        }
        if (inputPath.toString().includes('outside')) {
          return '/etc'; // Directory outside workspace
        }
        return inputPath.toString();
      });

      expect(() => {
        resolveInsideWorkspace(workspaceRoot, '../outside/nonexistent.txt');
      }).toThrow(McpToolError);
    });

    it('should handle filesystem errors gracefully', () => {
      mockFs.realpathSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      expect(() => {
        resolveInsideWorkspace(workspaceRoot, 'file.txt');
      }).toThrow(McpToolError);

      try {
        resolveInsideWorkspace(workspaceRoot, 'file.txt');
      } catch (error) {
        expect((error as McpToolError).code).toBe('FILE_RESOLUTION_ERROR');
      }
    });
  });

  describe('safeTempDir', () => {
    beforeEach(() => {
      mockOs.tmpdir.mockReturnValue('/tmp');
      vi.spyOn(process, 'pid', 'get').mockReturnValue(12345);
      
      // [Developer] Mock crypto.randomBytes
      vi.stubGlobal('crypto', {
        randomBytes: vi.fn().mockReturnValue(Buffer.from('abcdef1234567890', 'hex'))
      });
    });

    it('should create temp directory with unique name', () => {
      const tempDir = safeTempDir('test');
      
      expect(tempDir).toMatch(/^\/tmp\/pact-community-test-12345-[a-f0-9]{16}$/);
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        tempDir,
        { mode: 0o700 }
      );
    });

    it('should use default prefix when none provided', () => {
      const tempDir = safeTempDir();
      
      expect(tempDir).toMatch(/^\/tmp\/pact-community-mcp-12345-[a-f0-9]{16}$/);
    });

    it('should throw McpToolError on mkdir failure', () => {
      mockFs.mkdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      expect(() => {
        safeTempDir('test');
      }).toThrow(McpToolError);

      try {
        safeTempDir('test');
      } catch (error) {
        expect((error as McpToolError).code).toBe('TEMP_DIR_CREATE_FAILED');
      }
    });

    it('should create directories with owner-only permissions', () => {
      safeTempDir('secure');
      
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        { mode: 0o700 } // rwx------
      );
    });
  });

  describe('isPathInsideWorkspace', () => {
    const workspaceRoot = '/workspace';

    it('should return true for paths inside workspace', () => {
      expect(isPathInsideWorkspace(workspaceRoot, 'subdir/file.txt')).toBe(true);
      expect(isPathInsideWorkspace(workspaceRoot, '/workspace/subdir/file.txt')).toBe(true);
    });

    it('should return true for workspace root itself', () => {
      expect(isPathInsideWorkspace(workspaceRoot, '.')).toBe(true);
      expect(isPathInsideWorkspace(workspaceRoot, workspaceRoot)).toBe(true);
    });

    it('should return false for paths outside workspace', () => {
      expect(isPathInsideWorkspace(workspaceRoot, '../outside')).toBe(false);
      expect(isPathInsideWorkspace(workspaceRoot, '/etc/passwd')).toBe(false);
    });

    it('should return false for invalid paths', () => {
      // [Developer] Mock path operations to throw
      vi.spyOn(path, 'normalize').mockImplementation(() => {
        throw new Error('Invalid path');
      });

      expect(isPathInsideWorkspace(workspaceRoot, 'any-path')).toBe(false);

      vi.restoreAllMocks();
    });

    it('should handle relative vs absolute paths correctly', () => {
      expect(isPathInsideWorkspace('/workspace', 'file.txt')).toBe(true);
      expect(isPathInsideWorkspace('/workspace', '/workspace/file.txt')).toBe(true);
      expect(isPathInsideWorkspace('/workspace', '/other/file.txt')).toBe(false);
    });

    it('should handle trailing slashes consistently', () => {
      expect(isPathInsideWorkspace('/workspace/', 'file.txt')).toBe(true);
      expect(isPathInsideWorkspace('/workspace', 'subdir/')).toBe(true);
    });
  });
});