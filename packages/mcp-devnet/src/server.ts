/**
 * @fileoverview MCP Devnet server — high-level McpServer wiring.
 * @author Developer
 *
 * Registers 6 tools:
 *   devnet.status  (read-only)
 *   devnet.health  (read-only)
 *   devnet.logs    (read-only)
 *   devnet.up      (GATED — lifecycle flag required at call time)
 *   devnet.down    (GATED — lifecycle flag; volume wipe requires extra flag)
 *   devnet.reset   (GATED — both lifecycle + volume wipe flags required)
 *
 * Applies the ADR-MCP-001 security baseline inline:
 *   1. Root refusal.
 *   2. Audit log init.
 *   3. Env allowlist validation (non-strict).
 *   4. PACT_COMMUNITY_DEVNET_MODE === "devnet" assertion.
 *   5. docker binary resolution (which-alike).
 *   6. Tool schema drift check (tools.lock.json).
 *   7. Compose-file content validation for every agent whose file exists.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createAuditLogger,
  createAllowlistedFetch,
  validateEnv,
  verifyToolsLock,
  McpToolError,
  type AuditLogger
} from '@pact-community/mcp-shared';

import {
  AGENT_MAP,
  ALLOWED_DEVNET_ORIGINS,
  type AgentName
} from './agents.js';
import type { LifecycleFlags } from './gating.js';
import {
  resolveComposeFile,
  validateComposeFileContent
} from './docker/compose.js';

import {
  createStatusTool,
  StatusInputShape,
  type StatusResult
} from './tools/status.js';
import {
  createHealthTool,
  HealthInputShape,
  type HealthResult
} from './tools/health.js';
import {
  createLogsTool,
  LogsInputShape,
  type LogsResult
} from './tools/logs.js';
import {
  createUpTool,
  UpInputShape,
  type UpResult
} from './tools/up.js';
import {
  createDownTool,
  DownInputShape,
  type DownResult
} from './tools/down.js';
import {
  createResetTool,
  ResetInputShape,
  type ResetResult
} from './tools/reset.js';

export const SERVER_NAME = 'pact-community-devnet';
export const SERVER_VERSION = '0.1.0';

/** Env vars accepted from the parent process. */
export const ALLOWED_ENV = [
  'PACT_COMMUNITY_WORKSPACE_ROOT',
  'PACT_COMMUNITY_DEVNET_MODE',
  'PACT_COMMUNITY_DEVNET_ALLOW_LIFECYCLE',
  'PACT_COMMUNITY_DEVNET_ALLOW_VOLUME_WIPE',
  'PACT_COMMUNITY_DEVNET_DOCKER_BIN',
  'PACT_COMMUNITY_TOOLS_LOCKFILE',
  'PACT_COMMUNITY_TEST_ALLOW_ORIGINS',
  'PACT_COMMUNITY_TEST_AGENT_BASE_URLS',
  'NODE_ENV',
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'TZ',
  'PWD',
  'TMPDIR',
  'DOCKER_HOST'
];

/** Minimal env passed to the docker child process. */
const CHILD_ENV_ALLOW = new Set(['PATH', 'HOME', 'DOCKER_HOST']);

export interface ResolvedConfig {
  workspaceRoot: string;
  dockerBin: string;
  lockfilePath: string;
  flags: LifecycleFlags;
  childEnv: NodeJS.ProcessEnv;
  allowedOrigins: string[];
  additionalAllowedOrigins: string[];
  /** Test-only overrides for the per-agent HTTP base URL. */
  testAgentBaseUrls: Partial<Record<AgentName, string>>;
}

/**
 * [Developer] Apply the security baseline and compute resolved config. Exits
 * the process with code 13 on fatal misconfiguration.
 */
export function resolveConfig(): ResolvedConfig {
  // 1. Root refusal.
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    throw new McpToolError(
      'REFUSE_ROOT',
      'Refusing to run as root (uid 0)',
      false
    );
  }

  // 2. Audit log initialisation (ensures ~/.pact-community dir exists).
  createAuditLogger(SERVER_NAME);

  // 3. Env allowlist (non-strict — CI can set unrelated vars).
  const envResult = validateEnv({ allowed: ALLOWED_ENV, strict: false });

  // 4. Mode assertion.
  const mode = envResult.env['PACT_COMMUNITY_DEVNET_MODE'];
  if (mode !== 'devnet') {
    // eslint-disable-next-line no-console
    console.error(
      `[pact-community-devnet] PACT_COMMUNITY_DEVNET_MODE must be 'devnet' (got '${mode ?? '<unset>'}')`
    );
    process.exit(13);
  }

  // 5. Workspace root.
  const workspaceRoot = envResult.env['PACT_COMMUNITY_WORKSPACE_ROOT'];
  if (!workspaceRoot || workspaceRoot.length === 0) {
    throw new McpToolError(
      'CONFIG_MISSING',
      'PACT_COMMUNITY_WORKSPACE_ROOT environment variable is required',
      false
    );
  }
  if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
    throw new McpToolError(
      'CONFIG_INVALID',
      `PACT_COMMUNITY_WORKSPACE_ROOT is not a directory: ${workspaceRoot}`,
      false
    );
  }

  // 6. Docker binary resolution.
  const dockerBin = resolveDockerBinary(
    envResult.env['PACT_COMMUNITY_DEVNET_DOCKER_BIN'],
    envResult.env['PATH']
  );

  // 7. Lockfile drift check.
  const lockfilePath =
    envResult.env['PACT_COMMUNITY_TOOLS_LOCKFILE'] ?? './tools.lock.json';
  verifyToolsLock(SERVER_NAME, getToolSchemaObjects(), lockfilePath);

  // 8. Lifecycle flags.
  const flags: LifecycleFlags = {
    lifecycle:
      envResult.env['PACT_COMMUNITY_DEVNET_ALLOW_LIFECYCLE'] === 'true',
    volumeWipe:
      envResult.env['PACT_COMMUNITY_DEVNET_ALLOW_VOLUME_WIPE'] === 'true'
  };

  // 9. Compose-file content validation for each agent whose file exists.
  //    Missing files are tolerated (status returns a structured 'missing'
  //    result). Suspicious files fail startup.
  for (const agent of Object.values(AGENT_MAP)) {
    const r = resolveComposeFile(workspaceRoot, agent);
    if (r.state === 'present' && r.absolutePath) {
      validateComposeFileContent(r.absolutePath, agent);
    }
  }

  // 10. Child env — minimal allowlist passed to docker subprocess.
  const childEnv: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(envResult.env)) {
    if (CHILD_ENV_ALLOW.has(k) && typeof v === 'string') {
      childEnv[k] = v;
    }
  }

  return {
    workspaceRoot,
    dockerBin,
    lockfilePath,
    flags,
    childEnv,
    allowedOrigins: [...ALLOWED_DEVNET_ORIGINS],
    additionalAllowedOrigins: resolveTestOrigins(envResult.env),
    testAgentBaseUrls: resolveTestAgentBaseUrls(envResult.env)
  };
}

/**
 * [Developer] Parse PACT_COMMUNITY_TEST_ALLOW_ORIGINS. Honored ONLY when
 * NODE_ENV === 'test'. Any value in production is silently dropped.
 */
function resolveTestOrigins(env: Record<string, string>): string[] {
  if (env['NODE_ENV'] !== 'test') return [];
  const raw = env['PACT_COMMUNITY_TEST_ALLOW_ORIGINS'] ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * [Developer] Parse PACT_COMMUNITY_TEST_AGENT_BASE_URLS. Honored ONLY when
 * NODE_ENV === 'test'. Format: `Developer=http://127.0.0.1:33001,Tester=...`.
 */
function resolveTestAgentBaseUrls(
  env: Record<string, string>
): Partial<Record<AgentName, string>> {
  if (env['NODE_ENV'] !== 'test') return {};
  const raw = env['PACT_COMMUNITY_TEST_AGENT_BASE_URLS'] ?? '';
  const out: Partial<Record<AgentName, string>> = {};
  for (const pair of raw.split(',')) {
    const trimmed = pair.trim();
    if (trimmed.length === 0) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key in AGENT_MAP && value.length > 0) {
      out[key as AgentName] = value;
    }
  }
  return out;
}

/**
 * [Developer] Build (but do not connect) an McpServer with all 6 tools
 * registered. Unit tests use this with a test-shaped config.
 */
export function buildMcpServer(config: ResolvedConfig): McpServer {
  const auditLog = createAuditLogger(SERVER_NAME);

  const mcp = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  const fetchImpl = createAllowlistedFetch(config.allowedOrigins, {
    additionalAllowedOrigins: config.additionalAllowedOrigins
  });

  const status = createStatusTool({
    workspaceRoot: config.workspaceRoot,
    dockerBin: config.dockerBin,
    childEnv: config.childEnv
  });
  const health = createHealthTool({
    fetchImpl,
    baseUrlFor: (agent) =>
      config.testAgentBaseUrls[agent] ??
      `http://localhost:${AGENT_MAP[agent].port}`
  });
  const logs = createLogsTool({
    workspaceRoot: config.workspaceRoot,
    dockerBin: config.dockerBin,
    childEnv: config.childEnv
  });
  const up = createUpTool({
    workspaceRoot: config.workspaceRoot,
    dockerBin: config.dockerBin,
    childEnv: config.childEnv,
    flags: config.flags
  });
  const down = createDownTool({
    workspaceRoot: config.workspaceRoot,
    dockerBin: config.dockerBin,
    childEnv: config.childEnv,
    flags: config.flags
  });
  const reset = createResetTool({
    workspaceRoot: config.workspaceRoot,
    dockerBin: config.dockerBin,
    childEnv: config.childEnv,
    flags: config.flags
  });

  mcp.registerTool(
    'devnet.status',
    {
      title: 'Devnet container status',
      description:
        'Query docker-compose container state for an agent\'s devnet stack (Developer|Tester|Security). Missing compose files surface as overall=missing. Read-only.',
      inputSchema: StatusInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => wrap(auditLog, 'devnet.status', args, async () => {
      const { content } = await status(args);
      return content[0] as StatusResult;
    })
  );

  mcp.registerTool(
    'devnet.health',
    {
      title: 'Devnet Pact API health probe',
      description:
        'GET /info + /cut against the devnet endpoint (8081/8082/8083). Returns reachable, networkId, chainCount, genesisCaughtUp, latency. Never throws on connection failure.',
      inputSchema: HealthInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => wrap(auditLog, 'devnet.health', args, async () => {
      const { content } = await health(args);
      return content[0] as HealthResult;
    })
  );

  mcp.registerTool(
    'devnet.logs',
    {
      title: 'Devnet container log tail',
      description:
        'Read the tail of docker-compose logs (up to 10k lines). Output capped at 1MB and sanitized. Service name validated against /^[a-z][a-z0-9-]{0,63}$/.',
      inputSchema: LogsInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => wrap(auditLog, 'devnet.logs', args, async () => {
      const { content } = await logs(args);
      return content[0] as LogsResult;
    })
  );

  mcp.registerTool(
    'devnet.up',
    {
      title: 'Devnet start (GATED)',
      description:
        'Start the devnet stack via docker compose up -d. REQUIRES PACT_COMMUNITY_DEVNET_ALLOW_LIFECYCLE=true. Timeout 120s.',
      inputSchema: UpInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (args) => wrap(auditLog, 'devnet.up', args, async () => {
      const { content } = await up(args);
      return content[0] as UpResult;
    }, { destructive: true })
  );

  mcp.registerTool(
    'devnet.down',
    {
      title: 'Devnet stop + remove containers (GATED, DANGER)',
      description:
        'docker compose down. With wipeVolumes=true, also removes named volumes (DATA LOSS). REQUIRES PACT_COMMUNITY_DEVNET_ALLOW_LIFECYCLE=true, and PACT_COMMUNITY_DEVNET_ALLOW_VOLUME_WIPE=true for wipeVolumes.',
      inputSchema: DownInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (args) => wrap(auditLog, 'devnet.down', args, async () => {
      const { content } = await down(args);
      return content[0] as DownResult;
    }, { destructive: true })
  );

  mcp.registerTool(
    'devnet.reset',
    {
      title: 'Devnet reset (GATED, DANGER — DATA LOSS)',
      description:
        'Convenience: down -v followed by up --force-recreate. Full fresh devnet. REQUIRES both PACT_COMMUNITY_DEVNET_ALLOW_LIFECYCLE=true and PACT_COMMUNITY_DEVNET_ALLOW_VOLUME_WIPE=true.',
      inputSchema: ResetInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (args) => wrap(auditLog, 'devnet.reset', args, async () => {
      const { content } = await reset(args);
      return content[0] as ResetResult;
    }, { destructive: true })
  );

  return mcp;
}

/**
 * [Developer] Tool schemas for lockfile hashing.
 */
export function getToolSchemaObjects(): Record<
  string,
  { inputSchema: object }
> {
  return {
    'devnet.status': { inputSchema: StatusInputShape },
    'devnet.health': { inputSchema: HealthInputShape },
    'devnet.logs': { inputSchema: LogsInputShape },
    'devnet.up': { inputSchema: UpInputShape },
    'devnet.down': { inputSchema: DownInputShape },
    'devnet.reset': { inputSchema: ResetInputShape }
  };
}

// ---------------------------------------------------------------------------

/**
 * [Developer] Resolve the docker binary. Honors PACT_COMMUNITY_DEVNET_DOCKER_BIN
 * (absolute path) if set; otherwise walks PATH for a `docker` executable.
 * Exits 13 if none is found.
 */
export function resolveDockerBinary(
  override: string | undefined,
  pathEnv: string | undefined
): string {
  if (override && override.length > 0) {
    if (!path.isAbsolute(override)) {
      // eslint-disable-next-line no-console
      console.error(
        `[pact-community-devnet] PACT_COMMUNITY_DEVNET_DOCKER_BIN must be an absolute path (got '${override}')`
      );
      process.exit(13);
    }
    if (!fs.existsSync(override)) {
      // eslint-disable-next-line no-console
      console.error(
        `[pact-community-devnet] docker binary not found at PACT_COMMUNITY_DEVNET_DOCKER_BIN='${override}'`
      );
      process.exit(13);
    }
    return override;
  }

  const segments = (pathEnv ?? '').split(path.delimiter).filter(Boolean);
  for (const seg of segments) {
    const candidate = path.join(seg, 'docker');
    try {
      if (fs.existsSync(candidate)) {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) {
          return candidate;
        }
      }
    } catch {
      // skip unreadable path segment
    }
  }
  // eslint-disable-next-line no-console
  console.error(
    `[pact-community-devnet] docker binary not found on PATH. Set PACT_COMMUNITY_DEVNET_DOCKER_BIN to override.`
  );
  process.exit(13);
}

type WrapOpts = { destructive?: boolean };

/**
 * [Developer] Tool-call envelope — records audit entry and serialises
 * the payload to an MCP text content block. Exported for coverage tests.
 */
export async function wrap<T>(
  auditLog: AuditLogger,
  tool: string,
  args: unknown,
  fn: () => Promise<T>,
  opts: WrapOpts = {}
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const startedAt = Date.now();
  const agentName =
    typeof args === 'object' && args !== null && 'agent' in args
      ? String((args as { agent?: unknown }).agent ?? '<unknown>')
      : '<unknown>';
  try {
    const payload = await fn();
    auditLog.log({
      tool: opts.destructive ? `${tool} [DESTRUCTIVE agent=${agentName}]` : tool,
      inputHash: hashArgs(args),
      exitStatus: 0,
      durationMs: Date.now() - startedAt
    });
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload) }]
    };
  } catch (error) {
    auditLog.log({
      tool: opts.destructive ? `${tool} [DESTRUCTIVE agent=${agentName}]` : tool,
      inputHash: hashArgs(args),
      exitStatus: errorCode(error),
      durationMs: Date.now() - startedAt
    });
    throw error;
  }
}

/**
 * [Developer] Derive a short, stable hash of the tool arguments for the audit
 * log. Non-cryptographic; the audit log is integrity-signed separately.
 * Exported for coverage tests.
 */
export function hashArgs(args: unknown): string {
  try {
    return (
      'args:' +
      Buffer.from(JSON.stringify(args ?? null)).toString('base64').slice(0, 32)
    );
  } catch {
    return 'args:unhashable';
  }
}

/**
 * [Developer] Map a thrown error to an audit log exit status. Exported for
 * coverage tests.
 */
export function errorCode(error: unknown): string | number {
  if (error instanceof McpToolError) return error.code;
  return 1;
}

export type { AgentName };
