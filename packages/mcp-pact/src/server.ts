/**
 * @fileoverview MCP Pact server - high-level McpServer wiring
 * @description Applies pact-mcp security baseline then registers six
 *              tools (pact.repl_run, pact.module_scan, pact.repl_run_many,
 *              pact.gas_estimate, pact.interface_diff, pact.fmt_check) and
 *              one resource (pact://traps) on the SDK 1.18 McpServer API.
 */

import fs from 'node:fs';
import process from 'node:process';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  createAuditLogger,
  validateEnv,
  verifyToolsLock,
  resolveLockfilePath,
  McpToolError
} from '@pact-community/mcp-shared';

import {
  createReplRunTool,
  ReplRunInputShape,
  type ReplRunResult
} from './tools/repl-run.js';
import {
  createModuleScanTool,
  ModuleScanInputShape,
  type ModuleScanResult
} from './tools/module-scan.js';
import {
  createReplRunManyTool,
  ReplRunManyInputShape,
  type ReplRunManyResult
} from './tools/repl-run-many.js';
import {
  createGasEstimateTool,
  GasEstimateInputShape,
  type GasEstimateResult
} from './tools/gas-estimate.js';
import {
  createInterfaceDiffTool,
  InterfaceDiffInputShape,
  type InterfaceDiffResult
} from './tools/interface-diff.js';
import {
  createFmtCheckTool,
  FmtCheckInputShape,
  type FmtCheckResult
} from './tools/fmt-check.js';
import {
  readTrapsResource,
  TRAPS_RESOURCE_URI
} from './resources/traps-catalog.js';

export const SERVER_NAME = 'pact-community-pact';
export const SERVER_VERSION = '0.2.0';

/** Environment variables the server accepts from its parent process. */
export const ALLOWED_ENV = [
  'PACT_COMMUNITY_WORKSPACE_ROOT',
  'PACT_COMMUNITY_PACT_BIN',
  'PACT_COMMUNITY_TOOLS_LOCKFILE',
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
  'TMPDIR'
];

/** Environment variables forwarded to child pact processes. */
const CHILD_ENV_ALLOW = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'TZ',
  'PWD',
  'TMPDIR',
  'PACT_COMMUNITY_WORKSPACE_ROOT',
  'PACT_COMMUNITY_PACT_BIN'
]);

export interface ResolvedConfig {
  workspaceRoot: string;
  pactBin: string;
  lockfilePath: string;
  childEnv: NodeJS.ProcessEnv;
}

/**
 * Perform the pact-mcp security baseline checks and return a
 * resolved config. Throws on misconfiguration.
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

  // 2. Audit log initialisation (stateless side effect — ensures directory).
  createAuditLogger(SERVER_NAME);

  // 3. Env allowlist validation (non-strict — unknown vars logged + stripped,
  //    not process.exit — the allowlist is enforced again below when building
  //    the child env, which is what actually matters for sandboxing).
  const envResult = validateEnv({ allowed: ALLOWED_ENV, strict: false });

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

  const pactBin = envResult.env['PACT_COMMUNITY_PACT_BIN'] ?? 'pact';
  const lockfilePath =
    resolveLockfilePath(import.meta.url, envResult.env['PACT_COMMUNITY_TOOLS_LOCKFILE']);

  // 4. Tool schema drift check via tools.lock.json.
  verifyToolsLock(SERVER_NAME, getToolSchemaObjects(), lockfilePath);

  // 5. Filtered child env passed to pact binary.
  const childEnv: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(envResult.env)) {
    if (CHILD_ENV_ALLOW.has(k) && typeof v === 'string') {
      childEnv[k] = v;
    }
  }

  return { workspaceRoot, pactBin, lockfilePath, childEnv };
}

/**
 * Build (but do not connect) an McpServer with tools + resource
 * registered. Exposed so integration tests and bin.ts share a single codepath.
 */
export function buildMcpServer(config: ResolvedConfig): McpServer {
  const auditLog = createAuditLogger(SERVER_NAME);

  const mcp = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } }
  );

  const replRun = createReplRunTool({
    workspaceRoot: config.workspaceRoot,
    pactBin: config.pactBin,
    childEnv: config.childEnv
  });
  const moduleScan = createModuleScanTool({
    workspaceRoot: config.workspaceRoot
  });
  const replRunMany = createReplRunManyTool({
    workspaceRoot: config.workspaceRoot,
    pactBin: config.pactBin,
    childEnv: config.childEnv
  });
  const gasEstimate = createGasEstimateTool({
    workspaceRoot: config.workspaceRoot,
    pactBin: config.pactBin,
    childEnv: config.childEnv
  });
  const interfaceDiff = createInterfaceDiffTool({
    workspaceRoot: config.workspaceRoot
  });
  const fmtCheck = createFmtCheckTool({
    workspaceRoot: config.workspaceRoot
  });

  mcp.registerTool(
    'pact.repl_run',
    {
      title: 'Run Pact REPL file',
      description:
        'Execute a single .repl file via the pact binary and parse Load/expect/gas output. Local-only.',
      inputSchema: ReplRunInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const result = await replRun(args);
        const payload = result.content[0] as ReplRunResult;
        auditLog.log({
          tool: 'pact.repl_run',
          inputHash: hashArgs(args),
          exitStatus: payload.exitCode ?? -1,
          durationMs: Date.now() - startedAt
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          isError: !payload.success
        };
      } catch (error) {
        auditLog.log({
          tool: 'pact.repl_run',
          inputHash: hashArgs(args),
          exitStatus: errorCode(error),
          durationMs: Date.now() - startedAt
        });
        throw error;
      }
    }
  );

  mcp.registerTool(
    'pact.module_scan',
    {
      title: 'Scan Pact module for critical traps',
      description:
        'Static-analyze a .pact file for the 5 critical Pact 5 traps (non-binary +, try DML, enforce DB read, builtin shadow, bare pact-id).',
      inputSchema: ModuleScanInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const result = await moduleScan(args);
        const payload = result.content[0] as ModuleScanResult;
        auditLog.log({
          tool: 'pact.module_scan',
          inputHash: hashArgs(args),
          exitStatus: 0,
          durationMs: Date.now() - startedAt
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          isError: payload.hasCritical
        };
      } catch (error) {
        auditLog.log({
          tool: 'pact.module_scan',
          inputHash: hashArgs(args),
          exitStatus: errorCode(error),
          durationMs: Date.now() - startedAt
        });
        throw error;
      }
    }
  );

  mcp.registerTool(
    'pact.repl_run_many',
    {
      title: 'Run multiple Pact REPL files',
      description:
        'Sequentially execute a batch of .repl files and return per-file + aggregate results. Optional fail-fast. Local-only.',
      inputSchema: ReplRunManyInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const result = await replRunMany(args);
        const payload = result.content[0] as ReplRunManyResult;
        const anyFail = payload.summary.failed > 0;
        auditLog.log({
          tool: 'pact.repl_run_many',
          inputHash: hashArgs(args),
          exitStatus: anyFail ? 1 : 0,
          durationMs: Date.now() - startedAt
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          isError: anyFail
        };
      } catch (error) {
        auditLog.log({
          tool: 'pact.repl_run_many',
          inputHash: hashArgs(args),
          exitStatus: errorCode(error),
          durationMs: Date.now() - startedAt
        });
        throw error;
      }
    }
  );

  mcp.registerTool(
    'pact.gas_estimate',
    {
      title: 'Estimate gas from a .repl with probes',
      description:
        'Parse gas probes emitted by a .repl file (Gas: / env-gas) and return per-probe measurements. Does NOT inject probes.',
      inputSchema: GasEstimateInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const result = await gasEstimate(args);
        const payload = result.content[0] as GasEstimateResult;
        auditLog.log({
          tool: 'pact.gas_estimate',
          inputHash: hashArgs(args),
          exitStatus: payload.exitCode ?? -1,
          durationMs: Date.now() - startedAt
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          isError: payload.exitCode !== 0
        };
      } catch (error) {
        auditLog.log({
          tool: 'pact.gas_estimate',
          inputHash: hashArgs(args),
          exitStatus: errorCode(error),
          durationMs: Date.now() - startedAt
        });
        throw error;
      }
    }
  );

  mcp.registerTool(
    'pact.interface_diff',
    {
      title: 'Diff the public API of two .pact files',
      description:
        'Compare before/after .pact files and report added/removed/changed/unchanged symbols with a breakingChange flag.',
      inputSchema: InterfaceDiffInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const result = await interfaceDiff(args);
        const payload = result.content[0] as InterfaceDiffResult;
        auditLog.log({
          tool: 'pact.interface_diff',
          inputHash: hashArgs(args),
          exitStatus: payload.breakingChange ? 1 : 0,
          durationMs: Date.now() - startedAt
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          isError: false
        };
      } catch (error) {
        auditLog.log({
          tool: 'pact.interface_diff',
          inputHash: hashArgs(args),
          exitStatus: errorCode(error),
          durationMs: Date.now() - startedAt
        });
        throw error;
      }
    }
  );

  mcp.registerTool(
    'pact.fmt_check',
    {
      title: 'Check Pact file formatting (dry-run)',
      description:
        'Read-only formatting check for .pact/.repl files. Detects trailing whitespace, tabs, excess blank lines, missing newline, CRLF. Never writes.',
      inputSchema: FmtCheckInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const result = await fmtCheck(args);
        const payload = result.content[0] as FmtCheckResult;
        auditLog.log({
          tool: 'pact.fmt_check',
          inputHash: hashArgs(args),
          exitStatus: payload.summary.dirty > 0 ? 1 : 0,
          durationMs: Date.now() - startedAt
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          isError: false
        };
      } catch (error) {
        auditLog.log({
          tool: 'pact.fmt_check',
          inputHash: hashArgs(args),
          exitStatus: errorCode(error),
          durationMs: Date.now() - startedAt
        });
        throw error;
      }
    }
  );

  mcp.registerResource(
    'traps-catalog',
    TRAPS_RESOURCE_URI,
    {
      title: 'Pact 5 critical traps catalog',
      description: 'JSON catalog of the 5 critical Pact 5 language traps.',
      mimeType: 'application/json'
    },
    async () => readTrapsResource()
  );

  return mcp;
}

/**
 * Produce the tool input-schema objects for lockfile verification.
 * Must match what is passed to `registerTool` so hashes agree.
 */
export function getToolSchemaObjects(): Record<
  string,
  { inputSchema: object }
> {
  return {
    'pact.repl_run': { inputSchema: ReplRunInputShape },
    'pact.module_scan': { inputSchema: ModuleScanInputShape },
    'pact.repl_run_many': { inputSchema: ReplRunManyInputShape },
    'pact.gas_estimate': { inputSchema: GasEstimateInputShape },
    'pact.interface_diff': { inputSchema: InterfaceDiffInputShape },
    'pact.fmt_check': { inputSchema: FmtCheckInputShape }
  };
}

// ---------------------------------------------------------------------------

function hashArgs(args: unknown): string {
  try {
    return (
      'args:' +
      Buffer.from(JSON.stringify(args ?? null)).toString('base64').slice(0, 32)
    );
  } catch {
    return 'args:unhashable';
  }
}

function errorCode(error: unknown): string | number {
  if (error instanceof McpToolError) return error.code;
  return 1;
}
