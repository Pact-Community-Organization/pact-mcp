/**
 * @fileoverview Tests for MCP server baseline security
 * @author Developer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startServer } from '../src/server-baseline.js';

// [Developer] Mock process.getuid for testing
const mockGetUid = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // [Developer] Mock console.error to capture root refusal message
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process.exit called with code ${code}`);
  });
  
  // [Developer] Mock getuid function
  process.getuid = mockGetUid;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('server-baseline', () => {
  describe('root refusal', () => {
    it('should exit with code 13 when running as root', () => {
      mockGetUid.mockReturnValue(0); // Root UID

      expect(() => {
        startServer({
          name: 'test-server',
          version: '1.0.0'
        });
      }).toThrow('Process.exit called with code 13');

      expect(console.error).toHaveBeenCalledWith(
        '[MCP-SECURITY] Refusing to run as root (uid 0). Run as non-privileged user.'
      );
    });

    it('should proceed when not running as root', () => {
      mockGetUid.mockReturnValue(1000); // Non-root UID

      expect(() => {
        startServer({
          name: 'test-server',
          version: '1.0.0',
          envAllowlist: ['NODE_ENV', 'HOME'], // Allow basic env vars
          envStrict: false // Permissive mode for tests
        });
      }).not.toThrow();
    });

    it('should proceed when getuid is undefined (Windows)', () => {
      process.getuid = undefined;

      expect(() => {
        startServer({
          name: 'test-server',
          version: '1.0.0',
          envAllowlist: ['NODE_ENV', 'HOME'], // Allow basic env vars
          envStrict: false // Permissive mode for tests
        });
      }).not.toThrow();
    });
  });

  describe('configuration', () => {
    beforeEach(() => {
      mockGetUid.mockReturnValue(1000); // Non-root for config tests
    });

    it('should create server with correct name and version', () => {
      const server = startServer({
        name: 'test-server',
        version: '2.1.0',
        envAllowlist: ['NODE_ENV', 'HOME'], // Allow basic env vars
        envStrict: false // Permissive mode for tests
      });

      expect(server).toBeDefined();
      // [Developer] Server properties are not directly accessible, 
      // but we verify it doesn't throw during creation
    });

    it('should handle environment allowlist', () => {
      expect(() => {
        startServer({
          name: 'test-server',
          version: '1.0.0',
          envAllowlist: ['NODE_ENV', 'CUSTOM_VAR'],
          envStrict: false
        });
      }).not.toThrow();
    });

    it('should handle empty tools registry', () => {
      expect(() => {
        startServer({
          name: 'test-server',
          version: '1.0.0',
          tools: {},
          envAllowlist: ['NODE_ENV', 'HOME'], // Allow basic env vars
          envStrict: false // Permissive mode for tests
        });
      }).not.toThrow();
    });
  });
});