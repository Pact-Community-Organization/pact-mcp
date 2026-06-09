/**
 * @fileoverview MCP Chainweb server - high-level McpServer wiring.
 * @author Developer
 *
 * Devnet-only. Registers 11 tools (v0.2.0):
 *   MVP (v0.1):
 *     - chainweb.info
 *     - chainweb.chain_time
 *     - chainweb.local
 *     - chainweb.send
 *     - chainweb.poll
 *   v0.2 additions:
 *     - chainweb.read_table
 *     - chainweb.keys
 *     - chainweb.principal_namespace
 *     - chainweb.deploy_module
 *     - chainweb.continue_pact
 *     - chainweb.spv_proof
 *
 * Applies the ADR-MCP-001 security baseline inline (same pattern as
 * mcp-pact), then constructs an allowlisted HTTP client pointed at the
 * configured devnet base URL.
 */

import process from 'node:process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createAuditLogger,
  validateEnv,
  verifyToolsLock,
  McpToolError
} from '@pact-community/mcp-shared';

import {
  createChainwebClient,
  type ChainwebClient
} from './client/fetch.js';

import {
  createInfoTool,
  InfoInputShape,
  type InfoResult
} from './tools/info.js';
import {
  createChainTimeTool,
  ChainTimeInputShape,
  type ChainTimeResult
} from './tools/chain-time.js';
import {
  createLocalTool,
  LocalInputShape,
  type LocalResult
} from './tools/local.js';
import {
  createSendTool,
  SendInputShape,
  type SendResult
} from './tools/send.js';
import {
  createPollTool,
  PollInputShape,
  type PollResult
} from './tools/poll.js';
import {
  createReadTableTool,
  ReadTableInputShape,
  type ReadTableResult
} from './tools/read-table.js';
import {
  createKeysTool,
  KeysInputShape,
  type KeysResult
} from './tools/keys.js';
import {
  createPrincipalNamespaceTool,
  PrincipalNamespaceInputShape,
  type PrincipalNamespaceResult
} from './tools/principal-namespace.js';
import {
  createDeployModuleTool,
  DeployModuleInputShape,
  type DeployModuleResult
} from './tools/deploy-module.js';
import {
  createContinuePactTool,
  ContinuePactInputShape,
  type ContinuePactResult
} from './tools/continue-pact.js';
import {
  createSpvProofTool,
  SpvProofInputShape,
  type SpvProofResult
} from './tools/spv-proof.js';

export const SERVER_NAME = 'pact-community-chainweb';
export const SERVER_VERSION = '0.2.0';

/** Environment variables the server accepts from its parent process. */
export const ALLOWED_ENV = [
  'PACT_COMMUNITY_WORKSPACE_ROOT',
  'PACT_COMMUNITY_CHAINWEB_MODE',
  'PACT_COMMUNITY_CHAINWEB_BASE_URL',
  'PACT_COMMUNITY_CHAINWEB_NETWORK_ID',
  'PACT_COMMUNITY_TOOLS_LOCKFILE',
  // [Developer] Test-only: honored iff NODE_ENV === 'test'. Comma-separated
  // list of extra origins added to the fetch allowlist (e.g. a mock server
  // on 127.0.0.1:43517). In production this var is stripped/ignored — it
  // exists solely so the StdioClientTransport integration test can spawn
  // the built binary against a mock chainweb. Documented in SECURITY.md.
  'PACT_COMMUNITY_TEST_ALLOW_ORIGINS',
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

/** Production devnet allowlist — forge/guardian/security nginx ports. */
export const PROD_ALLOWED_ORIGINS: readonly string[] = Object.freeze([
  'http://localhost:8081',
  'http://localhost:8082',
  'http://localhost:8083'
]);

export interface ResolvedConfig {
  baseUrl: string;
  networkId: string;
  allowedOrigins: string[];
  /**
   * Programmatic test-only extension (never set from env). The bin entry
   * point does NOT populate this — only in-process test harnesses do.
   */
  additionalAllowedOrigins: string[];
  lockfilePath: string;
}

/**
 * [Developer] Apply ADR-MCP-001 baseline and compute the server config.
 * Hard-fails (exit 13) when `PACT_COMMUNITY_CHAINWEB_MODE !== "devnet"`.
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

  // 2. Audit log init.
  createAuditLogger(SERVER_NAME);

  // 3. Env allowlist — non-strict, same rationale as mcp-pact (tests inject
  //    CI env vars we don't care about).
  const envResult = validateEnv({ allowed: ALLOWED_ENV, strict: false });

  const mode = envResult.env['PACT_COMMUNITY_CHAINWEB_MODE'];
  if (mode !== 'devnet') {
    // [Developer] Hard exit 13 per orchestrator spec — this is the
    // devnet-only guarantee, enforced BEFORE tools are registered.
    // eslint-disable-next-line no-console
    console.error(
      `[pact-community-chainweb] PACT_COMMUNITY_CHAINWEB_MODE must be 'devnet' (got '${mode ?? '<unset>'}')`
    );
    process.exit(13);
  }

  const baseUrl =
    envResult.env['PACT_COMMUNITY_CHAINWEB_BASE_URL'] ?? 'http://localhost:8081';
  const networkId =
    envResult.env['PACT_COMMUNITY_CHAINWEB_NETWORK_ID'] ?? 'development';
  const lockfilePath =
    envResult.env['PACT_COMMUNITY_TOOLS_LOCKFILE'] ?? './tools.lock.json';

  // [Developer] Test-only additional origins. Honored ONLY when
  // NODE_ENV === 'test'. Any value in production is silently dropped.
  let additionalAllowedOrigins: string[] = [];
  if (envResult.env['NODE_ENV'] === 'test') {
    const raw = envResult.env['PACT_COMMUNITY_TEST_ALLOW_ORIGINS'] ?? '';
    additionalAllowedOrigins = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  // 4. Re-validate baseUrl against the production allowlist (defence in
  //    depth: the allowlisted fetch does this too, but failing here at
  //    startup is a clearer signal). When test-mode extra origins are
  //    active, include them in the check so the integration test can point
  //    the server at a 127.0.0.1:{ephemeral} mock without loosening prod.
  const startupAllowlist = [
    ...PROD_ALLOWED_ORIGINS,
    ...additionalAllowedOrigins
  ];
  try {
    const parsed = new URL(baseUrl);
    if (!startupAllowlist.includes(parsed.origin)) {
      // eslint-disable-next-line no-console
      console.error(
        `[pact-community-chainweb] PACT_COMMUNITY_CHAINWEB_BASE_URL origin '${parsed.origin}' is not in the devnet allowlist: ${startupAllowlist.join(', ')}`
      );
      process.exit(13);
    }
  } catch {
    // eslint-disable-next-line no-console
    console.error(
      `[pact-community-chainweb] PACT_COMMUNITY_CHAINWEB_BASE_URL is not a valid URL: ${baseUrl}`
    );
    process.exit(13);
  }

  // 5. Tool schema drift check.
  verifyToolsLock(SERVER_NAME, getToolSchemaObjects(), lockfilePath);

  return {
    baseUrl,
    networkId,
    allowedOrigins: [...PROD_ALLOWED_ORIGINS],
    additionalAllowedOrigins,
    lockfilePath
  };
}

/**
 * [Developer] Build (but do not connect) an McpServer. Test harnesses call
 * this with a config that may include `additionalAllowedOrigins` to point
 * the chainweb client at an in-process mock server.
 */
export function buildMcpServer(config: ResolvedConfig): McpServer {
  const client = createChainwebClient({
    baseUrl: config.baseUrl,
    networkId: config.networkId,
    allowedOrigins: config.allowedOrigins,
    ...(config.additionalAllowedOrigins.length > 0
      ? { additionalAllowedOrigins: config.additionalAllowedOrigins }
      : {})
  });
  return buildMcpServerWithClient(client);
}

/**
 * [Developer] Lower-level factory used by unit tests that want to inject a
 * pre-built client directly (e.g. with a stubbed mock base URL).
 */
export function buildMcpServerWithClient(client: ChainwebClient): McpServer {
  const auditLog = createAuditLogger(SERVER_NAME);

  const mcp = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  const info = createInfoTool({ client });
  const chainTime = createChainTimeTool({ client });
  const local = createLocalTool({ client });
  const send = createSendTool({ client });
  const poll = createPollTool({ client });
  const readTable = createReadTableTool({ client });
  const keys = createKeysTool({ client });
  const principalNs = createPrincipalNamespaceTool({ client });
  const deployModule = createDeployModuleTool({ client });
  const continuePact = createContinuePactTool({ client });
  const spvProof = createSpvProofTool({ client });

  mcp.registerTool(
    'chainweb.info',
    {
      title: 'Chainweb node info',
      description:
        'Fetch /info and /cut from the devnet chainweb node. Refuses if the network id is not "development".',
      inputSchema: InfoInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => wrap(auditLog, 'chainweb.info', args, async () => {
      const { content } = await info(args);
      return content[0] as InfoResult;
    })
  );

  mcp.registerTool(
    'chainweb.chain_time',
    {
      title: 'Chainweb latest block time',
      description:
        'Return the latest block header for a chain (creationTimeSec, blockHeight, blockHash).',
      inputSchema: ChainTimeInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => wrap(auditLog, 'chainweb.chain_time', args, async () => {
      const { content } = await chainTime(args);
      return content[0] as ChainTimeResult;
    })
  );

  mcp.registerTool(
    'chainweb.local',
    {
      title: 'Chainweb local preflight',
      description:
        'Execute Pact code against /local with preflight=true. Read-only. Returns unwrapped Pact values.',
      inputSchema: LocalInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => wrap(auditLog, 'chainweb.local', args, async () => {
      const { content } = await local(args);
      return content[0] as LocalResult;
    })
  );

  mcp.registerTool(
    'chainweb.send',
    {
      title: 'Chainweb send signed transaction',
      description:
        'Run local preflight on a pre-signed {cmd,hash,sigs} tx. Refuses on preflight failure. POSTs to /send and returns { requestKey, preflight }.',
      inputSchema: SendInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (args) => wrap(auditLog, 'chainweb.send', args, async () => {
      const { content } = await send(args);
      return content[0] as SendResult;
    })
  );

  mcp.registerTool(
    'chainweb.poll',
    {
      title: 'Chainweb poll transaction results',
      description:
        'Poll /poll (NOT /listen — nginx 504 trap) until request keys resolve or timeout. Returns unwrapped results.',
      inputSchema: PollInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => wrap(auditLog, 'chainweb.poll', args, async () => {
      const { content } = await poll(args);
      return content[0] as PollResult;
    })
  );

  mcp.registerTool(
    'chainweb.read_table',
    {
      title: 'Chainweb read single table row',
      description:
        'Read a single row from a Pact table via /local. Auto-unwraps Pact JSON types. Missing key returns keyFound=false (not an error).',
      inputSchema: ReadTableInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => wrap(auditLog, 'chainweb.read_table', args, async () => {
      const { content } = await readTable(args);
      return content[0] as ReadTableResult;
    })
  );

  mcp.registerTool(
    'chainweb.keys',
    {
      title: 'Chainweb list keys of a Pact table',
      description:
        'List row keys of a Pact table (truncated at `limit`). O(n) on-chain — large tables may exceed gas.',
      inputSchema: KeysInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => wrap(auditLog, 'chainweb.keys', args, async () => {
      const { content } = await keys(args);
      return content[0] as KeysResult;
    })
  );

  mcp.registerTool(
    'chainweb.principal_namespace',
    {
      title: 'Chainweb compute principal namespace from keyset',
      description:
        'Compute the deterministic n_<40hex> principal namespace name from a keyset via /local (ns.create-principal-namespace).',
      inputSchema: PrincipalNamespaceInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) =>
      wrap(auditLog, 'chainweb.principal_namespace', args, async () => {
        const { content } = await principalNs(args);
        return content[0] as PrincipalNamespaceResult;
      })
  );

  mcp.registerTool(
    'chainweb.deploy_module',
    {
      title: 'Chainweb deploy Pact module (preflight + optional submit)',
      description:
        'Build an UNSCOPED-signer deploy tx (with create-table calls in the same tx), preflight via /local, and — iff sigs are supplied — submit to /send. Without sigs, returns the unsigned envelope for external signing. NEVER accepts private keys.',
      inputSchema: DeployModuleInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (args) =>
      wrap(auditLog, 'chainweb.deploy_module', args, async () => {
        const { content } = await deployModule(args);
        return content[0] as DeployModuleResult;
      })
  );

  mcp.registerTool(
    'chainweb.continue_pact',
    {
      title: 'Chainweb continue cross-chain defpact step',
      description:
        'Build a continuation cmd (scoped signer) for a defpact step, preflight via /local on the target chain, and submit iff sigs are supplied. Caller must supply any SPV proof (see chainweb.spv_proof) and manage transitive-deps.',
      inputSchema: ContinuePactInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (args) =>
      wrap(auditLog, 'chainweb.continue_pact', args, async () => {
        const { content } = await continuePact(args);
        return content[0] as ContinuePactResult;
      })
  );

  mcp.registerTool(
    'chainweb.spv_proof',
    {
      title: 'Chainweb fetch SPV proof for cross-chain tx',
      description:
        'Fetch the base64 SPV proof for a cross-chain request key from /chain/<source>/pact/spv. Not-ready responses surface as ready=false (not an error). Pass proof through to chainweb.continue_pact.',
      inputSchema: SpvProofInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) =>
      wrap(auditLog, 'chainweb.spv_proof', args, async () => {
        const { content } = await spvProof(args);
        return content[0] as SpvProofResult;
      })
  );

  return mcp;
}

export function getToolSchemaObjects(): Record<
  string,
  { inputSchema: object }
> {
  return {
    'chainweb.info': { inputSchema: InfoInputShape },
    'chainweb.chain_time': { inputSchema: ChainTimeInputShape },
    'chainweb.local': { inputSchema: LocalInputShape },
    'chainweb.send': { inputSchema: SendInputShape },
    'chainweb.poll': { inputSchema: PollInputShape },
    'chainweb.read_table': { inputSchema: ReadTableInputShape },
    'chainweb.keys': { inputSchema: KeysInputShape },
    'chainweb.principal_namespace': {
      inputSchema: PrincipalNamespaceInputShape
    },
    'chainweb.deploy_module': { inputSchema: DeployModuleInputShape },
    'chainweb.continue_pact': { inputSchema: ContinuePactInputShape },
    'chainweb.spv_proof': { inputSchema: SpvProofInputShape }
  };
}

// ---------------------------------------------------------------------------

type AuditLogger = ReturnType<typeof createAuditLogger>;

async function wrap<T>(
  auditLog: AuditLogger,
  tool: string,
  args: unknown,
  fn: () => Promise<T>
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const startedAt = Date.now();
  try {
    const payload = await fn();
    auditLog.log({
      tool,
      inputHash: hashArgs(args),
      exitStatus: 0,
      durationMs: Date.now() - startedAt
    });
    const isError =
      isObject(payload) && 'status' in payload && payload.status === 'failure';
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
      ...(isError ? { isError: true } : {})
    };
  } catch (error) {
    auditLog.log({
      tool,
      inputHash: hashArgs(args),
      exitStatus: errorCode(error),
      durationMs: Date.now() - startedAt
    });
    throw error;
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

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
