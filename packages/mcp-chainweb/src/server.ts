/**
 * @fileoverview MCP Chainweb server - high-level McpServer wiring.
 *
 * Devnet-first. Registers 11 tools (v0.2.0):
 *   MVP (v0.1):
 *     - chainweb_info
 *     - chainweb_chain_time
 *     - chainweb_local
 *     - chainweb_send
 *     - chainweb_poll
 *   v0.2 additions:
 *     - chainweb_read_table
 *     - chainweb_keys
 *     - chainweb_principal_namespace
 *     - chainweb_deploy_module
 *     - chainweb_continue_pact
 *     - chainweb_spv_proof
 *
 * Applies the pact-mcp security baseline inline (same pattern as
 * mcp-pact), then constructs an allowlisted HTTP client pointed at the
 * configured profile base URL.
 */

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
export const SERVER_VERSION = '0.3.0';

/** Environment variables the server accepts from its parent process. */
export const ALLOWED_ENV = [
  'PACT_COMMUNITY_WORKSPACE_ROOT',
  'PACT_COMMUNITY_CHAINWEB_MODE',
  'PACT_COMMUNITY_CHAINWEB_PROFILE',
  'PACT_COMMUNITY_CHAINWEB_BASE_URL',
  'PACT_COMMUNITY_CHAINWEB_NETWORK_ID',
  'PACT_COMMUNITY_TOOLS_LOCKFILE',
  // Test-only: honored iff NODE_ENV === 'test'. Comma-separated
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

export const TESTNET06_ALLOWED_ORIGINS: readonly string[] = Object.freeze([
  'https://api.testnet.chainweb-community.org'
]);

export const MAINNET_ALLOWED_ORIGINS: readonly string[] = Object.freeze([
  'https://api.chainweb-community.org'
]);

export type ChainwebProfile = 'devnet' | 'testnet06' | 'mainnet';

interface ProfileDefaults {
  profile: ChainwebProfile;
  defaultBaseUrl: string;
  defaultNetworkId: string;
  allowedOrigins: readonly string[];
  writesEnabled: boolean;
}

const PROFILE_DEFAULTS: Readonly<Record<ChainwebProfile, ProfileDefaults>> = {
  devnet: {
    profile: 'devnet',
    defaultBaseUrl: 'http://localhost:8081',
    defaultNetworkId: 'development',
    allowedOrigins: PROD_ALLOWED_ORIGINS,
    writesEnabled: true
  },
  testnet06: {
    profile: 'testnet06',
    defaultBaseUrl: 'https://api.testnet.chainweb-community.org',
    defaultNetworkId: 'testnet06',
    allowedOrigins: TESTNET06_ALLOWED_ORIGINS,
    writesEnabled: false
  },
  mainnet: {
    profile: 'mainnet',
    defaultBaseUrl: 'https://api.chainweb-community.org',
    defaultNetworkId: 'mainnet01',
    allowedOrigins: MAINNET_ALLOWED_ORIGINS,
    writesEnabled: false
  }
};

export interface ResolvedConfig {
  profile: ChainwebProfile;
  baseUrl: string;
  networkId: string;
  allowedOrigins: string[];
  writesEnabled: boolean;
  /**
   * Programmatic test-only extension (never set from env). The bin entry
   * point does NOT populate this — only in-process test harnesses do.
   */
  additionalAllowedOrigins: string[];
  lockfilePath: string;
}

/**
 * Apply the pact-mcp security baseline baseline and compute the server config.
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
  const profileRaw = envResult.env['PACT_COMMUNITY_CHAINWEB_PROFILE'] ?? 'devnet';
  if (!isSupportedProfile(mode)) {
    // eslint-disable-next-line no-console
    console.error(
      `[pact-community-chainweb] PACT_COMMUNITY_CHAINWEB_MODE must be one of: devnet, testnet06, mainnet (got '${mode ?? '<unset>'}')`
    );
    process.exit(13);
  }
  if (!isSupportedProfile(profileRaw)) {
    // eslint-disable-next-line no-console
    console.error(
      `[pact-community-chainweb] PACT_COMMUNITY_CHAINWEB_PROFILE must be one of: devnet, testnet06, mainnet (got '${profileRaw}')`
    );
    process.exit(13);
  }

  if (mode !== profileRaw) {
    // eslint-disable-next-line no-console
    console.error(
      `[pact-community-chainweb] PACT_COMMUNITY_CHAINWEB_MODE ('${mode}') must match PACT_COMMUNITY_CHAINWEB_PROFILE ('${profileRaw}')`
    );
    process.exit(13);
  }

  const profile = profileRaw;
  const defaults = PROFILE_DEFAULTS[profile];

  const baseUrl =
    envResult.env['PACT_COMMUNITY_CHAINWEB_BASE_URL'] ?? defaults.defaultBaseUrl;
  const networkId =
    envResult.env['PACT_COMMUNITY_CHAINWEB_NETWORK_ID'] ?? defaults.defaultNetworkId;
  const lockfilePath =
    resolveLockfilePath(import.meta.url, envResult.env['PACT_COMMUNITY_TOOLS_LOCKFILE']);

  // Test-only additional origins. Honored ONLY when
  // NODE_ENV === 'test'. Any value in production is silently dropped.
  let additionalAllowedOrigins: string[] = [];
  if (envResult.env['NODE_ENV'] === 'test') {
    const raw = envResult.env['PACT_COMMUNITY_TEST_ALLOW_ORIGINS'] ?? '';
    additionalAllowedOrigins = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  // 4. Re-validate baseUrl against the selected profile allowlist (defence in
  //    depth: the allowlisted fetch does this too, but failing here at
  //    startup is a clearer signal). When test-mode extra origins are
  //    active, include them in the check so the integration test can point
  //    the server at a 127.0.0.1:{ephemeral} mock without loosening prod.
  const startupAllowlist = [...defaults.allowedOrigins, ...additionalAllowedOrigins];
  try {
    const parsed = new URL(baseUrl);
    if (!startupAllowlist.includes(parsed.origin)) {
      // eslint-disable-next-line no-console
      console.error(
        `[pact-community-chainweb] PACT_COMMUNITY_CHAINWEB_BASE_URL origin '${parsed.origin}' is not in the ${profile} allowlist: ${startupAllowlist.join(', ')}`
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
    profile,
    baseUrl,
    networkId,
    allowedOrigins: [...defaults.allowedOrigins],
    writesEnabled: defaults.writesEnabled,
    additionalAllowedOrigins,
    lockfilePath
  };
}

/**
 * Build (but do not connect) an McpServer. Test harnesses call
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
  return buildMcpServerWithClient(client, {
    profile: config.profile,
    writesEnabled: config.writesEnabled
  });
}

/**
 * Lower-level factory used by unit tests that want to inject a
 * pre-built client directly (e.g. with a stubbed mock base URL).
 */
export function buildMcpServerWithClient(
  client: ChainwebClient,
  options: { profile?: ChainwebProfile; writesEnabled?: boolean } = {}
): McpServer {
  const auditLog = createAuditLogger(SERVER_NAME);
  const runtimeProfile = options.profile ?? 'devnet';
  const writesEnabled = options.writesEnabled ?? true;

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
    'chainweb_info',
    {
      title: 'Chainweb node info',
      description:
        'Fetch /info and /cut from the configured chainweb profile. Refuses if the network id differs from the configured expectation.',
      inputSchema: InfoInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => wrap(auditLog, 'chainweb_info', args, async () => {
      const { content } = await info(args);
      return content[0] as InfoResult;
    })
  );

  mcp.registerTool(
    'chainweb_chain_time',
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
    async (args) => wrap(auditLog, 'chainweb_chain_time', args, async () => {
      const { content } = await chainTime(args);
      return content[0] as ChainTimeResult;
    })
  );

  mcp.registerTool(
    'chainweb_local',
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
    async (args) => wrap(auditLog, 'chainweb_local', args, async () => {
      const { content } = await local(args);
      return content[0] as LocalResult;
    })
  );

  mcp.registerTool(
    'chainweb_send',
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
    async (args) => wrap(auditLog, 'chainweb_send', args, async () => {
      ensureWritesAllowed(runtimeProfile, writesEnabled, 'chainweb_send');
      const { content } = await send(args);
      return content[0] as SendResult;
    })
  );

  mcp.registerTool(
    'chainweb_poll',
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
    async (args) => wrap(auditLog, 'chainweb_poll', args, async () => {
      const { content } = await poll(args);
      return content[0] as PollResult;
    })
  );

  mcp.registerTool(
    'chainweb_read_table',
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
    async (args) => wrap(auditLog, 'chainweb_read_table', args, async () => {
      const { content } = await readTable(args);
      return content[0] as ReadTableResult;
    })
  );

  mcp.registerTool(
    'chainweb_keys',
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
    async (args) => wrap(auditLog, 'chainweb_keys', args, async () => {
      const { content } = await keys(args);
      return content[0] as KeysResult;
    })
  );

  mcp.registerTool(
    'chainweb_principal_namespace',
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
      wrap(auditLog, 'chainweb_principal_namespace', args, async () => {
        const { content } = await principalNs(args);
        return content[0] as PrincipalNamespaceResult;
      })
  );

  mcp.registerTool(
    'chainweb_deploy_module',
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
      wrap(auditLog, 'chainweb_deploy_module', args, async () => {
        ensureWritesAllowed(
          runtimeProfile,
          writesEnabled,
          'chainweb_deploy_module'
        );
        const { content } = await deployModule(args);
        return content[0] as DeployModuleResult;
      })
  );

  mcp.registerTool(
    'chainweb_continue_pact',
    {
      title: 'Chainweb continue cross-chain defpact step',
      description:
        'Build a continuation cmd (scoped signer) for a defpact step, preflight via /local on the target chain, and submit iff sigs are supplied. Caller must supply any SPV proof (see chainweb_spv_proof) and manage transitive-deps.',
      inputSchema: ContinuePactInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (args) =>
      wrap(auditLog, 'chainweb_continue_pact', args, async () => {
        ensureWritesAllowed(
          runtimeProfile,
          writesEnabled,
          'chainweb_continue_pact'
        );
        const { content } = await continuePact(args);
        return content[0] as ContinuePactResult;
      })
  );

  mcp.registerTool(
    'chainweb_spv_proof',
    {
      title: 'Chainweb fetch SPV proof for cross-chain tx',
      description:
        'Fetch the base64 SPV proof for a cross-chain request key from /chain/<source>/pact/spv. Not-ready responses surface as ready=false (not an error). Pass proof through to chainweb_continue_pact.',
      inputSchema: SpvProofInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) =>
      wrap(auditLog, 'chainweb_spv_proof', args, async () => {
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
    'chainweb_info': { inputSchema: InfoInputShape },
    'chainweb_chain_time': { inputSchema: ChainTimeInputShape },
    'chainweb_local': { inputSchema: LocalInputShape },
    'chainweb_send': { inputSchema: SendInputShape },
    'chainweb_poll': { inputSchema: PollInputShape },
    'chainweb_read_table': { inputSchema: ReadTableInputShape },
    'chainweb_keys': { inputSchema: KeysInputShape },
    'chainweb_principal_namespace': {
      inputSchema: PrincipalNamespaceInputShape
    },
    'chainweb_deploy_module': { inputSchema: DeployModuleInputShape },
    'chainweb_continue_pact': { inputSchema: ContinuePactInputShape },
    'chainweb_spv_proof': { inputSchema: SpvProofInputShape }
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

function isSupportedProfile(value: string | undefined): value is ChainwebProfile {
  return value === 'devnet' || value === 'testnet06' || value === 'mainnet';
}

function ensureWritesAllowed(
  profile: ChainwebProfile,
  writesEnabled: boolean,
  toolName: string
): void {
  if (writesEnabled) return;
  throw new McpToolError(
    'PROFILE_WRITE_BLOCKED',
    `PROFILE_WRITE_BLOCKED: ${toolName} is disabled for profile '${profile}'. Public profiles are read-only; use profile 'devnet' for mutating operations.`,
    false
  );
}
