/**
 * @fileoverview Tests for MCP audit logging
 * @author Developer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createAuditLogger } from '../src/audit-log.js';

// [Developer] Mock filesystem and home directory
vi.mock('node:fs');
vi.mock('node:os');

const mockFs = vi.mocked(fs);
const mockOs = vi.mocked(os);

beforeEach(() => {
  vi.clearAllMocks();
  
  // [Developer] Mock home directory
  mockOs.homedir.mockReturnValue('/mock/home');
  
  // [Developer] Mock filesystem operations
  mockFs.existsSync.mockReturnValue(false);
  mockFs.mkdirSync.mockImplementation(() => {});
  mockFs.writeFileSync.mockImplementation(() => {});
  
  // [Developer] Mock console.error for write failures
  vi.spyOn(console, 'error').mockImplementation(() => {});
  
  // [Developer] Mock Date for deterministic timestamps
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-21T10:30:45.123Z'));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('audit-log', () => {
  describe('createAuditLogger', () => {
    it('should create audit directory if it does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      
      const logger = createAuditLogger('test-server');
      
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        '/mock<local-path>
        { recursive: true, mode: 0o700 }
      );
    });

    it('should not create directory if it already exists', () => {
      mockFs.existsSync.mockReturnValue(true);
      
      const logger = createAuditLogger('test-server');
      
      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should return correct log path for current date', () => {
      const logger = createAuditLogger('test-server');
      
      expect(logger.getLogPath()).toBe('/mock<local-path>);
    });
  });

  describe('logging', () => {
    it('should log entry with correct format', () => {
      const logger = createAuditLogger('test-server');
      
      logger.log({
        tool: 'test-tool',
        inputHash: 'sha256:abc123',
        exitStatus: 0,
        durationMs: 1500
      });

      const expectedLogEntry = JSON.stringify({
        timestamp: '2026-04-21T10:30:45.123Z',
        server: 'test-server',
        tool: 'test-tool',
        inputHash: 'sha256:abc123',
        exitStatus: 0,
        durationMs: 1500
      }) + '\n';

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/mock<local-path>
        expectedLogEntry,
        { flag: 'a', mode: 0o600 }
      );
    });

    it('should handle string exit status', () => {
      const logger = createAuditLogger('test-server');
      
      logger.log({
        tool: 'test-tool',
        inputHash: 'sha256:def456',
        exitStatus: 'NETWORK_ERROR',
        durationMs: 500
      });

      const expectedLogEntry = JSON.stringify({
        timestamp: '2026-04-21T10:30:45.123Z',
        server: 'test-server',
        tool: 'test-tool',
        inputHash: 'sha256:def456',
        exitStatus: 'NETWORK_ERROR',
        durationMs: 500
      }) + '\n';

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/mock<local-path>
        expectedLogEntry,
        { flag: 'a', mode: 0o600 }
      );
    });

    it('should handle write failures gracefully', () => {
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const logger = createAuditLogger('test-server');
      
      // [Developer] Should not throw, just log to stderr
      expect(() => {
        logger.log({
          tool: 'test-tool',
          inputHash: 'sha256:abc123',
          exitStatus: 0,
          durationMs: 100
        });
      }).not.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[MCP-AUDIT] Failed to write audit log')
      );
    });
  });

  describe('daily rotation', () => {
    it('should use different log files for different dates', () => {
      const logger = createAuditLogger('test-server');
      
      // [Developer] Log on 2026-04-21
      logger.log({
        tool: 'test-tool',
        inputHash: 'sha256:day1',
        exitStatus: 0,
        durationMs: 100
      });

      // [Developer] Advance to next day
      vi.setSystemTime(new Date('2026-04-22T10:30:45.123Z'));
      
      logger.log({
        tool: 'test-tool',
        inputHash: 'sha256:day2',
        exitStatus: 0,
        durationMs: 200
      });

      // [Developer] Should have written to different files
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/mock<local-path>
        expect.stringContaining('sha256:day1'),
        expect.any(Object)
      );

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/mock<local-path>
        expect.stringContaining('sha256:day2'),
        expect.any(Object)
      );
    });
  });
});