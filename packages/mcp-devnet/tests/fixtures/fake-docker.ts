/**
 * @fileoverview Test fixtures — fake `docker` binaries used to drive
 *               `runDocker` in unit tests without any real Docker.
 *
 * Each fixture is a small Node script that reads `argv`, writes deterministic
 * stdout/stderr, and exits with a configurable code. Tests point
 * `dockerBin` at the path of one of these scripts.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface FakeDockerSpec {
  /** Exact stdout to write (no trailing newline is added). */
  stdout?: string;
  /** Exact stderr to write. */
  stderr?: string;
  /** Process exit code. Default 0. */
  exitCode?: number;
  /**
   * Optional delay (ms) before writing output. Used by timeout tests.
   * Default 0 (write immediately).
   */
  delayMs?: number;
  /**
   * Optional argv capture file — when set, the fixture writes the raw JSON
   * argv to this file so assertions can inspect what was invoked.
   */
  argvCaptureFile?: string;
}

/**
 * Create a fake docker binary that emits the configured output.
 * Returns the absolute path to a chmod +x Node script.
 */
export function createFakeDocker(spec: FakeDockerSpec = {}): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-docker-'));
  const scriptPath = path.join(tmpDir, 'docker');
  const encoded = JSON.stringify(spec);
  const src = `#!/usr/bin/env node
const spec = ${encoded};
const fs = require('node:fs');
if (spec.argvCaptureFile) {
  try { fs.writeFileSync(spec.argvCaptureFile, JSON.stringify(process.argv.slice(2))); } catch {}
}
function writeSync(fd, data) {
  // Block-write via fs.writeSync so large payloads flush fully before exit
  // (process.stdout.write is async on pipes and may drop bytes on exit).
  if (!data || data.length === 0) return;
  const buf = Buffer.from(data, 'utf-8');
  let offset = 0;
  while (offset < buf.length) {
    offset += fs.writeSync(fd, buf, offset, buf.length - offset);
  }
}
function emit() {
  if (spec.stdout) writeSync(1, spec.stdout);
  if (spec.stderr) writeSync(2, spec.stderr);
  process.exit(typeof spec.exitCode === 'number' ? spec.exitCode : 0);
}
if (spec.delayMs && spec.delayMs > 0) {
  setTimeout(emit, spec.delayMs);
} else {
  emit();
}
`;
  fs.writeFileSync(scriptPath, src, { mode: 0o755 });
  return scriptPath;
}

/** Remove the tmp dir containing a fake docker script. */
export function cleanupFakeDocker(scriptPath: string): void {
  try {
    fs.rmSync(path.dirname(scriptPath), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/**
 * Seed a temporary workspace with a valid compose file for the
 * Developer agent. Returns the workspace root.
 */
export function createTempWorkspace(
  composeFiles: Record<string, string> = {}
): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-devnet-ws-'));
  fs.mkdirSync(path.join(ws, 'dao'), { recursive: true });
  for (const [rel, content] of Object.entries(composeFiles)) {
    const abs = path.join(ws, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return ws;
}

export function cleanupTempWorkspace(ws: string): void {
  try {
    fs.rmSync(ws, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/** Valid compose YAML passing the preflight check. */
export const VALID_COMPOSE_CONTENT = `services:
  bootstrap-node:
    container_name: devnet-forge-bootstrap
    image: busybox:latest
  mining-client:
    container_name: devnet-forge-miner
    image: busybox:latest
`;

/** Compose with an out-of-allowlist container_name. */
export const SUSPICIOUS_COMPOSE_CONTENT = `services:
  prod-db:
    container_name: production-postgres
    image: postgres:16
`;
