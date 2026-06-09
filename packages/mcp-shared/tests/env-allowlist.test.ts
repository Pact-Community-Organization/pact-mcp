/**
 * @fileoverview Tests for environment variable allowlist validation
 * @author Developer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateEnv } from '../src/env-allowlist.js';

// [Developer] Mock process.env for testing
const originalEnv = process.env;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process.exit called with code ${code}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = originalEnv;
});

describe('env-allowlist', () => {
  describe('validateEnv', () => {
    it('should include allowed variables in sanitized env', () => {
      process.env = {
        NODE_ENV: 'test',
        CUSTOM_VAR: 'allowed',
        UNKNOWN_VAR: 'unknown'
      };

      const result = validateEnv({
        allowed: ['CUSTOM_VAR'],
        strict: false
      });

      expect(result.env.NODE_ENV).toBe('test'); // Core variable
      expect(result.env.CUSTOM_VAR).toBe('allowed'); // Allowed variable
    });

    it('should include core Node.js variables automatically', () => {
      process.env = {
        NODE_ENV: 'production',
        PATH: '/usr/bin',
        HOME: '<local-path>
        USER: 'testuser'
      };

      const result = validateEnv({
        allowed: [],
        strict: false
      });

      expect(result.env.NODE_ENV).toBe('production');
      expect(result.env.PATH).toBe('/usr/bin');
      expect(result.env.HOME).toBe('<local-path>);
      expect(result.env.USER).toBe('testuser');
    });

    it('should handle unknown variables in permissive mode', () => {
      process.env = {
        NODE_ENV: 'test',
        UNKNOWN_VAR1: 'value1',
        UNKNOWN_VAR2: 'value2'
      };

      const result = validateEnv({
        allowed: [],
        strict: false
      });

      // [Developer] In permissive mode, unknown vars are included
      expect(result.env.UNKNOWN_VAR1).toBe('value1');
      expect(result.env.UNKNOWN_VAR2).toBe('value2');
      expect(result.unknown).toEqual(['UNKNOWN_VAR1', 'UNKNOWN_VAR2']);
      expect(result.rejected).toEqual([]);
    });

    it('should reject unknown variables in strict mode', () => {
      process.env = {
        NODE_ENV: 'test',
        ALLOWED_VAR: 'allowed',
        REJECTED_VAR1: 'rejected1',
        REJECTED_VAR2: 'rejected2'
      };

      expect(() => {
        validateEnv({
          allowed: ['ALLOWED_VAR'],
          strict: true
        });
      }).toThrow('Process.exit called with code 13');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Rejected environment variables in strict mode')
      );
    });

    it('should not exit in strict mode when no unknown variables', () => {
      process.env = {
        NODE_ENV: 'test',
        ALLOWED_VAR: 'allowed'
      };

      expect(() => {
        validateEnv({
          allowed: ['ALLOWED_VAR'],
          strict: true
        });
      }).not.toThrow();
    });

    it('should skip undefined environment variables', () => {
      process.env = {
        NODE_ENV: 'test',
        DEFINED_VAR: 'value',
        UNDEFINED_VAR: undefined
      };

      const result = validateEnv({
        allowed: ['DEFINED_VAR'],
        strict: false
      });

      expect(result.env.DEFINED_VAR).toBe('value');
      expect(result.env.UNDEFINED_VAR).toBeUndefined();
    });

    it('should return correct rejection info in strict mode attempt', () => {
      process.env = {
        NODE_ENV: 'test',
        GOOD_VAR: 'good',
        BAD_VAR1: 'bad1',
        BAD_VAR2: 'bad2'
      };

      let caughtError = false;
      try {
        validateEnv({
          allowed: ['GOOD_VAR'],
          strict: true
        });
      } catch (error) {
        caughtError = true;
        expect((error as Error).message).toContain('Process.exit called with code 13');
      }

      expect(caughtError).toBe(true);
    });

    it('should handle empty allowed list', () => {
      process.env = {
        NODE_ENV: 'test',
        PATH: '/usr/bin'
      };

      const result = validateEnv({
        allowed: [],
        strict: false
      });

      // [Developer] Core variables should still be included
      expect(result.env.NODE_ENV).toBe('test');
      expect(result.env.PATH).toBe('/usr/bin');
    });

    it('should handle case sensitivity correctly', () => {
      process.env = {
        NODE_ENV: 'test',
        MY_VAR: 'value',
        my_var: 'lowercase' // Different from MY_VAR
      };

      const result = validateEnv({
        allowed: ['MY_VAR'], // Only uppercase allowed
        strict: false
      });

      expect(result.env.MY_VAR).toBe('value');
      expect(result.env.my_var).toBe('lowercase'); // Should be in unknown
      expect(result.unknown).toContain('my_var');
    });

    it('should handle empty process.env', () => {
      process.env = {};

      const result = validateEnv({
        allowed: ['CUSTOM_VAR'],
        strict: true
      });

      expect(result.env).toEqual({});
      expect(result.rejected).toEqual([]);
      expect(result.unknown).toEqual([]);
    });
  });
});