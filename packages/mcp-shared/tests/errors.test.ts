/**
 * @fileoverview Tests for MCP error types and factories
 */

import { describe, it, expect } from 'vitest';
import {
  McpToolError,
  ErrorCodes,
  createSecurityError,
  createRetryableError,
  createValidationError,
  createNetworkError,
  createFileSystemError
} from '../src/errors.js';

describe('errors', () => {
  describe('McpToolError', () => {
    it('should create error with basic properties', () => {
      const error = new McpToolError('TEST_CODE', 'Test message');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('McpToolError');
      expect(error.code).toBe('TEST_CODE');
      expect(error.message).toBe('Test message');
      expect(error.retryable).toBe(false);
      expect(error.sanitized).toBe(false);
      expect(error.toolName).toBeUndefined();
    });

    it('should create error with all properties', () => {
      const error = new McpToolError(
        'TOOL_ERROR',
        'Tool failed',
        true, // retryable
        'test-tool'
      );

      expect(error.code).toBe('TOOL_ERROR');
      expect(error.message).toBe('Tool failed');
      expect(error.retryable).toBe(true);
      expect(error.toolName).toBe('test-tool');
    });

    it('should maintain proper stack trace', () => {
      const error = new McpToolError('TEST_CODE', 'Test message');
      
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('McpToolError');
    });
  });

  describe('error sanitization', () => {
    it('should create sanitized copy of error', () => {
      const original = new McpToolError(
        'FILE_ERROR',
        'Failed to read /tmp/private/module.pact',
        false,
        'file-reader'
      );

      const sanitized = original.sanitize();

      expect(sanitized).not.toBe(original); // Different instance
      expect(sanitized.code).toBe('FILE_ERROR');
      expect(sanitized.retryable).toBe(false);
      expect(sanitized.toolName).toBe('file-reader');
      expect(sanitized.sanitized).toBe(true);

      // Message should be sanitized
      expect(sanitized.message).toContain('[FILE_ERROR]');
      expect(sanitized.message).not.toContain('/tmp/private/module.pact');
      expect(sanitized.message).toContain('[PATH]');
    });

    it('should sanitize Unix file paths', () => {
      const error = new McpToolError('FILE_ERROR', 'Cannot access /etc/passwd');
      const sanitized = error.sanitize();

      expect(sanitized.message).not.toContain('/etc/passwd');
      expect(sanitized.message).toContain('[PATH]');
    });

    it('should sanitize Windows file paths', () => {
      const error = new McpToolError('FILE_ERROR', 'Cannot access C:\\Windows\\System32\\config');
      const sanitized = error.sanitize();

      expect(sanitized.message).not.toContain('C:\\Windows\\System32\\config');
      expect(sanitized.message).toContain('[PATH]');
    });

    it('should sanitize IP addresses', () => {
      const error = new McpToolError('NETWORK_ERROR', 'Failed to connect to 192.168.1.100');
      const sanitized = error.sanitize();

      expect(sanitized.message).not.toContain('192.168.1.100');
      expect(sanitized.message).toContain('[IP]');
    });

    it('should sanitize hash values', () => {
      const error = new McpToolError(
        'HASH_ERROR', 
        'Invalid hash: a1b2c3d4e5f6789012345678901234567890abcdef'
      );
      const sanitized = error.sanitize();

      expect(sanitized.message).not.toContain('a1b2c3d4e5f6789012345678901234567890abcdef');
      expect(sanitized.message).toContain('[HASH]');
    });

    it('should preserve non-sensitive information', () => {
      const error = new McpToolError('VALIDATION_ERROR', 'Invalid input: value must be positive');
      const sanitized = error.sanitize();

      expect(sanitized.message).toContain('Invalid input');
      expect(sanitized.message).toContain('value must be positive');
      expect(sanitized.message).toContain('[VALIDATION_ERROR]');
    });

    it('should handle multiple sensitive patterns in one message', () => {
      const error = new McpToolError(
        'COMPLEX_ERROR',
        'Failed to hash file /tmp/private/module.pact with result abc123def456: connection to 10.0.0.1 failed'
      );
      const sanitized = error.sanitize();

      expect(sanitized.message).not.toContain('/tmp/private/module.pact');
      expect(sanitized.message).not.toContain('abc123def456');
      expect(sanitized.message).not.toContain('10.0.0.1');
      expect(sanitized.message).toContain('[PATH]');
      expect(sanitized.message).toContain('[HASH]');
      expect(sanitized.message).toContain('[IP]');
    });
  });

  describe('ErrorCodes', () => {
    it('should contain all expected error codes', () => {
      expect(ErrorCodes.ROOT_EXECUTION).toBe('ROOT_EXECUTION');
      expect(ErrorCodes.FILE_OUTSIDE_WORKSPACE).toBe('FILE_OUTSIDE_WORKSPACE');
      expect(ErrorCodes.NETWORK_ALLOWLIST_VIOLATION).toBe('NETWORK_ALLOWLIST_VIOLATION');
      expect(ErrorCodes.ENV_VAR_REJECTED).toBe('ENV_VAR_REJECTED');
      expect(ErrorCodes.TOOL_SCHEMA_DRIFT).toBe('TOOL_SCHEMA_DRIFT');
      expect(ErrorCodes.SPAWN_FORBIDDEN_SHELL).toBe('SPAWN_FORBIDDEN_SHELL');
      expect(ErrorCodes.SPAWN_INVALID_ARGS).toBe('SPAWN_INVALID_ARGS');
      expect(ErrorCodes.LOCKFILE_READ_ERROR).toBe('LOCKFILE_READ_ERROR');
      expect(ErrorCodes.INVALID_INPUT).toBe('INVALID_INPUT');
    });

    it('should be readonly', () => {
      expect(() => {
        (ErrorCodes as any).NEW_CODE = 'NEW_CODE';
      }).toThrow();
    });
  });

  describe('factory functions', () => {
    describe('createSecurityError', () => {
      it('should create non-retryable security error', () => {
        const error = createSecurityError('SECURITY_VIOLATION', 'Access denied');

        expect(error).toBeInstanceOf(McpToolError);
        expect(error.code).toBe('SECURITY_VIOLATION');
        expect(error.message).toBe('Access denied');
        expect(error.retryable).toBe(false);
      });
    });

    describe('createRetryableError', () => {
      it('should create retryable error', () => {
        const error = createRetryableError('TEMP_FAILURE', 'Temporary issue');

        expect(error).toBeInstanceOf(McpToolError);
        expect(error.code).toBe('TEMP_FAILURE');
        expect(error.message).toBe('Temporary issue');
        expect(error.retryable).toBe(true);
      });
    });

    describe('createValidationError', () => {
      it('should create validation error with standard code', () => {
        const error = createValidationError('Invalid data format');

        expect(error).toBeInstanceOf(McpToolError);
        expect(error.code).toBe(ErrorCodes.INVALID_INPUT);
        expect(error.message).toBe('Invalid data format');
        expect(error.retryable).toBe(false);
      });
    });

    describe('createNetworkError', () => {
      it('should create retryable network error by default', () => {
        const error = createNetworkError('Connection failed');

        expect(error).toBeInstanceOf(McpToolError);
        expect(error.code).toBe(ErrorCodes.NETWORK_REQUEST_FAILED);
        expect(error.message).toBe('Connection failed');
        expect(error.retryable).toBe(true);
      });

      it('should create non-retryable network error when specified', () => {
        const error = createNetworkError('Invalid URL', false);

        expect(error).toBeInstanceOf(McpToolError);
        expect(error.code).toBe(ErrorCodes.NETWORK_REQUEST_FAILED);
        expect(error.message).toBe('Invalid URL');
        expect(error.retryable).toBe(false);
      });
    });

    describe('createFileSystemError', () => {
      it('should create non-retryable filesystem error', () => {
        const error = createFileSystemError('FILE_NOT_FOUND', 'File does not exist');

        expect(error).toBeInstanceOf(McpToolError);
        expect(error.code).toBe('FILE_NOT_FOUND');
        expect(error.message).toBe('File does not exist');
        expect(error.retryable).toBe(false);
      });
    });
  });

  describe('error inheritance', () => {
    it('should work with instanceof checks', () => {
      const mcpError = new McpToolError('TEST', 'message');
      const baseError = new Error('base error');

      expect(mcpError instanceof McpToolError).toBe(true);
      expect(mcpError instanceof Error).toBe(true);
      expect(baseError instanceof McpToolError).toBe(false);
    });

    it('should work with try-catch', () => {
      expect(() => {
        throw new McpToolError('TEST', 'test error');
      }).toThrow(McpToolError);

      expect(() => {
        throw new McpToolError('TEST', 'test error');
      }).toThrow(Error);
    });
  });

  describe('error serialization', () => {
    it('should serialize to JSON properly', () => {
      const error = new McpToolError('TEST_CODE', 'Test message', true, 'test-tool');
      
      const serialized = JSON.stringify(error);
      const parsed = JSON.parse(serialized);

      expect(parsed.name).toBe('McpToolError');
      expect(parsed.code).toBe('TEST_CODE');
      expect(parsed.message).toBe('Test message');
      expect(parsed.retryable).toBe(true);
      expect(parsed.toolName).toBe('test-tool');
    });

    it('should handle circular references gracefully', () => {
      const error = new McpToolError('TEST', 'message');
      (error as any).circular = error; // Create circular reference

      expect(() => JSON.stringify(error)).not.toThrow();
    });
  });
});