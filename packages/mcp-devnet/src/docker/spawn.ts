/**
 * @fileoverview Docker spawn wrapper with timeout, kill-escalation, size caps,
 *               and stderr/stdout capture.
 *
 * Built on top of mcp-shared's `spawnSafe` (argv-only, shell:false).
 */

import type { ChildProcess } from 'node:child_process';
import { spawnSafe, McpToolError } from '@pact-community/mcp-shared';

/** 1MB per stream — matches the tool-call cap. */
export const STREAM_CAP_BYTES = 1024 * 1024;

/** Grace period before SIGKILL after SIGTERM. */
export const KILL_GRACE_MS = 5_000;

export interface DockerSpawnOptions {
  /** Working directory (usually dirname of the compose file). */
  cwd: string;
  /** Timeout in milliseconds. */
  timeoutMs: number;
  /**
   * Env passed to the child process. The wrapper does NOT inject anything —
   * callers construct the allowlisted env map once at startup.
   */
  env: NodeJS.ProcessEnv;
}

export interface DockerSpawnResult {
  /** Final exit code; `null` means the process was killed before exit. */
  exitCode: number | null;
  /** Captured stdout, capped at STREAM_CAP_BYTES. */
  stdout: string;
  /** Captured stderr, capped at STREAM_CAP_BYTES. */
  stderr: string;
  /** True iff either stream was truncated. */
  truncated: boolean;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /**
   * Reason the process ended. `exit` is the normal path; `timeout` means we
   * sent SIGTERM/SIGKILL; `error` means the `error` event fired.
   */
  endReason: 'exit' | 'timeout' | 'error';
  /** If endReason is `error`, the captured message. */
  errorMessage?: string;
}

/**
 * Run the docker binary with a strict timeout and controlled
 * output capture. Does NOT throw on non-zero exit — callers decide what to do
 * with the structured result. Throws only on spawn-guard violations (e.g. the
 * caller passed shell metacharacters, which is a bug not a runtime failure).
 */
export async function runDocker(
  dockerBin: string,
  argv: string[],
  options: DockerSpawnOptions
): Promise<DockerSpawnResult> {
  const started = Date.now();

  // spawnSafe throws McpSpawnError (shell metachar / non-string / uid 0 / etc.)
  // — those are bugs in the caller and should propagate.
  const child: ChildProcess = spawnSafe(dockerBin, argv, {
    cwd: options.cwd,
    env: options.env,
    stdio: 'pipe'
  });

  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutTruncated = false;
  let stderrTruncated = false;
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  if (child.stdout) {
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= STREAM_CAP_BYTES) {
        stdoutTruncated = true;
        return;
      }
      const remaining = STREAM_CAP_BYTES - stdoutBytes;
      if (chunk.length <= remaining) {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      } else {
        stdoutChunks.push(chunk.subarray(0, remaining));
        stdoutBytes = STREAM_CAP_BYTES;
        stdoutTruncated = true;
      }
    });
  }
  if (child.stderr) {
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes >= STREAM_CAP_BYTES) {
        stderrTruncated = true;
        return;
      }
      const remaining = STREAM_CAP_BYTES - stderrBytes;
      if (chunk.length <= remaining) {
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
      } else {
        stderrChunks.push(chunk.subarray(0, remaining));
        stderrBytes = STREAM_CAP_BYTES;
        stderrTruncated = true;
      }
    });
  }

  return new Promise<DockerSpawnResult>((resolve) => {
    let settled = false;
    let endReason: DockerSpawnResult['endReason'] = 'exit';
    let errorMessage: string | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    // `close` fires after the process exits AND all stdio streams
    // close. BUT in some Node builds under load the underlying pipe buffer
    // can still have data the Readable hasn't yet emitted as 'data' — so we
    // gate `finalize` on both `close` *and* stream 'end' events where
    // applicable, to ensure we never resolve with partially-captured output.
    let processClosed = false;
    let stdoutEnded = child.stdout ? false : true;
    let stderrEnded = child.stderr ? false : true;
    let pendingExitCode: number | null = null;

    const maybeFinalize = (): void => {
      if (settled) return;
      if (!(processClosed && stdoutEnded && stderrEnded)) return;
      finalize(pendingExitCode);
    };

    if (child.stdout) {
      child.stdout.on('end', () => {
        stdoutEnded = true;
        maybeFinalize();
      });
    }
    if (child.stderr) {
      child.stderr.on('end', () => {
        stderrEnded = true;
        maybeFinalize();
      });
    }

    const finalize = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      clearTimeout(timeoutTimer);
      const result: DockerSpawnResult = {
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        truncated: stdoutTruncated || stderrTruncated,
        durationMs: Date.now() - started,
        endReason
      };
      if (errorMessage !== undefined) {
        result.errorMessage = errorMessage;
      }
      resolve(result);
    };

    const timeoutTimer = setTimeout(() => {
      if (settled) return;
      endReason = 'timeout';
      try {
        child.kill('SIGTERM');
      } catch {
        // process may already be dead — ignore
      }
      killTimer = setTimeout(() => {
        if (settled) return;
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        // If the process never closes after SIGKILL, force-resolve.
        setTimeout(() => finalize(null), 500).unref();
      }, KILL_GRACE_MS);
      killTimer.unref();
    }, options.timeoutMs);
    timeoutTimer.unref();

    child.on('close', (exitCode) => {
      processClosed = true;
      pendingExitCode = exitCode;
      maybeFinalize();
    });
    child.on('error', (err: Error) => {
      endReason = 'error';
      errorMessage = err.message;
      finalize(null);
    });
  });
}

/**
 * Convert a timeout result into a structured McpToolError so
 * tools can surface it consistently.
 */
export function timeoutError(result: DockerSpawnResult): McpToolError {
  return new McpToolError(
    'SPAWN_TIMEOUT',
    `docker command timed out after ${result.durationMs}ms`,
    true
  );
}
