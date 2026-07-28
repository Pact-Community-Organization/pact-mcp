/**
 * @fileoverview Compose file validation + `docker compose ps --format json`
 *               output parsing.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  McpToolError,
  resolveInsideWorkspace
} from '@pact-community/mcp-shared';

import type { AgentMapping } from '../agents.js';

/** Bytes of a compose file we inspect at load time. */
const COMPOSE_PREFLIGHT_BYTES = 32 * 1024; // 32KB — enough for container_name

export type ComposeState = 'present' | 'missing';

export interface ComposeResolution {
  /** Agent slug for this compose file. */
  slug: string;
  /** Canonical absolute path to the compose file. Undefined when missing. */
  absolutePath?: string;
  /** Absolute path as the tool expected (for display). */
  attemptedPath: string;
  /** Whether the file currently exists on disk. */
  state: ComposeState;
  /** Directory used as cwd for `docker compose -f <file>`. Undefined when missing. */
  workDir?: string;
}

/**
 * Resolve + validate a compose file path for the given agent.
 *
 * - Path is hardcoded from the agent map — callers NEVER control the file.
 * - Resolved path must live inside the workspace root (via fs-guard).
 * - Missing files return `state: 'missing'` so `devnet_status` can return a
 *   structured result — caller decides whether this is fatal.
 */
export function resolveComposeFile(
  workspaceRoot: string,
  agent: AgentMapping
): ComposeResolution {
  const attemptedAbs = path.join(workspaceRoot, agent.composeRelPath);
  if (!fs.existsSync(attemptedAbs)) {
    return {
      slug: agent.slug,
      attemptedPath: attemptedAbs,
      state: 'missing'
    };
  }
  // resolveInsideWorkspace uses realpath + workspace prefix check. This is
  // the security-critical check — it catches symlinks escaping the
  // workspace.
  const canonical = resolveInsideWorkspace(
    workspaceRoot,
    agent.composeRelPath
  );
  return {
    slug: agent.slug,
    absolutePath: canonical,
    attemptedPath: attemptedAbs,
    state: 'present',
    workDir: path.dirname(canonical)
  };
}

/**
 * Lightweight compose-file content check.
 *
 * Reads at most COMPOSE_PREFLIGHT_BYTES and:
 *  1. Requires a top-level `services:` key (rejects random YAML files).
 *  2. Scans every `container_name:` entry and enforces the
 *     agent's whitelist regex. Prevents pointing the server at, e.g.,
 *     `docker-compose.production.yml` which names `production-db`.
 *
 * Runs once at server start for each agent's compose file.
 */
export function validateComposeFileContent(
  absolutePath: string,
  agent: AgentMapping
): void {
  let fh: number | undefined;
  try {
    fh = fs.openSync(absolutePath, 'r');
    const buf = Buffer.alloc(COMPOSE_PREFLIGHT_BYTES);
    const bytesRead = fs.readSync(fh, buf, 0, buf.length, 0);
    const content = buf.subarray(0, bytesRead).toString('utf-8');

    // 1. `services:` key check. We accept it at column 0 OR as the first
    //    non-comment non-blank line after `services:`.
    const hasServices = /^services\s*:\s*$/m.test(content);
    if (!hasServices) {
      throw new McpToolError(
        'COMPOSE_FILE_SUSPICIOUS',
        `Compose file '${absolutePath}' has no top-level 'services:' key`,
        false
      );
    }

    // 2. container_name allowlist.
    const nameRegex = /^\s*container_name\s*:\s*['"]?([^'"\n#]+?)['"]?\s*(?:#.*)?$/gm;
    let match: RegExpExecArray | null;
    while ((match = nameRegex.exec(content)) !== null) {
      const name = (match[1] ?? '').trim();
      if (!agent.containerNameRegex.test(name)) {
        throw new McpToolError(
          'COMPOSE_FILE_SUSPICIOUS',
          `Compose file '${absolutePath}' references suspicious container_name '${name}' — refusing to operate`,
          false
        );
      }
    }
  } catch (error) {
    if (error instanceof McpToolError) throw error;
    throw new McpToolError(
      'COMPOSE_FILE_SUSPICIOUS',
      `Failed to validate compose file '${absolutePath}': ${(error as Error).message ?? String(error)}`,
      false
    );
  } finally {
    if (fh !== undefined) {
      try {
        fs.closeSync(fh);
      } catch {
        // ignore
      }
    }
  }
}

// ---------------------------------------------------------------------------
// `docker compose ps --format json` parsing
// ---------------------------------------------------------------------------

export type ServiceRunState =
  | 'running'
  | 'exited'
  | 'restarting'
  | 'paused'
  | 'created'
  | 'dead'
  | 'unknown';

export interface ParsedService {
  name: string;
  state: ServiceRunState;
  status: string;
  ports: string[];
  health?: string;
}

export type OverallState = 'up' | 'partial' | 'down' | 'missing';

export interface ParsedPs {
  services: ParsedService[];
  overall: OverallState;
}

interface RawPsEntry {
  Name?: string;
  Service?: string;
  State?: string;
  Status?: string;
  Health?: string;
  Publishers?: Array<{
    URL?: string;
    TargetPort?: number;
    PublishedPort?: number;
    Protocol?: string;
  }>;
  Ports?: string;
}

/**
 * Parse `docker compose ps --format json` output.
 *
 * Docker emits either NDJSON (one object per line) or a single JSON array
 * depending on the compose version. Handle both. Unknown fields are ignored.
 */
export function parseComposePs(stdout: string): ParsedPs {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return { services: [], overall: 'down' };
  }
  let rawEntries: RawPsEntry[] = [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        rawEntries = parsed as RawPsEntry[];
      }
    } catch {
      // fall through — try NDJSON below
      rawEntries = [];
    }
  }

  if (rawEntries.length === 0) {
    for (const line of trimmed.split(/\r?\n/)) {
      const l = line.trim();
      if (l.length === 0) continue;
      try {
        rawEntries.push(JSON.parse(l) as RawPsEntry);
      } catch {
        // skip unparseable lines
      }
    }
  }

  const services: ParsedService[] = rawEntries.map((raw) => {
    const name =
      typeof raw.Service === 'string' && raw.Service.length > 0
        ? raw.Service
        : typeof raw.Name === 'string'
          ? raw.Name
          : 'unknown';
    const ports = extractPorts(raw);
    const svc: ParsedService = {
      name,
      state: normalizeState(raw.State),
      status: typeof raw.Status === 'string' ? raw.Status : '',
      ports
    };
    if (typeof raw.Health === 'string' && raw.Health.length > 0) {
      svc.health = raw.Health;
    }
    return svc;
  });

  const overall: OverallState =
    services.length === 0
      ? 'down'
      : services.every((s) => s.state === 'running')
        ? 'up'
        : services.some((s) => s.state === 'running')
          ? 'partial'
          : 'down';

  return { services, overall };
}

function normalizeState(state: unknown): ServiceRunState {
  if (typeof state !== 'string') return 'unknown';
  const s = state.toLowerCase();
  if (s === 'running') return 'running';
  if (s === 'exited') return 'exited';
  if (s === 'restarting') return 'restarting';
  if (s === 'paused') return 'paused';
  if (s === 'created') return 'created';
  if (s === 'dead') return 'dead';
  return 'unknown';
}

function extractPorts(raw: RawPsEntry): string[] {
  const result: string[] = [];
  if (Array.isArray(raw.Publishers)) {
    for (const p of raw.Publishers) {
      if (!p || typeof p !== 'object') continue;
      const published = typeof p.PublishedPort === 'number' ? p.PublishedPort : undefined;
      const target = typeof p.TargetPort === 'number' ? p.TargetPort : undefined;
      if (published !== undefined && target !== undefined) {
        result.push(`${published}->${target}/${p.Protocol ?? 'tcp'}`);
      } else if (target !== undefined) {
        result.push(`${target}/${p.Protocol ?? 'tcp'}`);
      }
    }
  }
  if (result.length === 0 && typeof raw.Ports === 'string' && raw.Ports.length > 0) {
    for (const part of raw.Ports.split(',')) {
      const p = part.trim();
      if (p.length > 0) result.push(p);
    }
  }
  return result;
}
