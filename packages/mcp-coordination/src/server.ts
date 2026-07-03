/**
 * @fileoverview MCP Coordination server — high-level McpServer wiring.
 *
 * Applies the pact-mcp security baseline inline (same pattern as mcp-pact
 * and mcp-chainweb) and registers exactly 10 tools.
 *
 * NO network I/O, NO subprocess spawn. All persistence lives under a
 * validated coordination root.
 */

import process from 'node:process';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  createAuditLogger,
  validateEnv,
  verifyToolsLock,
  resolveLockfilePath,
  McpToolError,
  ErrorCodes,
  type AuditLogger
} from '@pact-community/mcp-shared';

import {
  createCoordPaths,
  verifyCoordRoot,
  type CoordPaths
} from './fs/paths.js';

import {
  createTaskCreateTool,
  TaskCreateInputShape
} from './tools/task-create.js';
import {
  createTaskListTool,
  TaskListInputShape
} from './tools/task-list.js';
import {
  createTaskGetTool,
  TaskGetInputShape
} from './tools/task-get.js';
import {
  createTaskUpdateTool,
  TaskUpdateInputShape
} from './tools/task-update.js';
import {
  createTaskCompleteTool,
  TaskCompleteInputShape
} from './tools/task-complete.js';
import {
  createMailboxSendTool,
  MailboxSendInputShape
} from './tools/mailbox-send.js';
import {
  createMailboxReadTool,
  MailboxReadInputShape
} from './tools/mailbox-read.js';
import {
  createMailboxAckTool,
  MailboxAckInputShape
} from './tools/mailbox-ack.js';
import {
  createStatusSetTool,
  StatusSetInputShape
} from './tools/status-set.js';
import {
  createMemoryAppendTool,
  MemoryAppendInputShape
} from './tools/memory-append.js';

export const SERVER_NAME = 'pact-community-coordination';
export const SERVER_VERSION = '0.1.0';

export const ALLOWED_ENV = [
  'PACT_COMMUNITY_WORKSPACE_ROOT',
  'PACT_COMMUNITY_COORDINATION_ROOT',
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

export interface ResolvedConfig {
  workspaceRoot: string;
  coordinationRoot: string;
  lockfilePath: string;
}

export function resolveConfig(): ResolvedConfig {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    throw new McpToolError('REFUSE_ROOT', 'Refusing to run as root (uid 0)', false);
  }

  createAuditLogger(SERVER_NAME);

  const envResult = validateEnv({ allowed: ALLOWED_ENV, strict: false });

  const workspaceRoot = envResult.env['PACT_COMMUNITY_WORKSPACE_ROOT'];
  if (!workspaceRoot || workspaceRoot.length === 0) {
    // eslint-disable-next-line no-console
    console.error(
      '[pact-community-coordination] PACT_COMMUNITY_WORKSPACE_ROOT environment variable is required'
    );
    process.exit(13);
  }
  if (!path.isAbsolute(workspaceRoot)) {
    // eslint-disable-next-line no-console
    console.error(
      `[pact-community-coordination] PACT_COMMUNITY_WORKSPACE_ROOT must be absolute (got ${workspaceRoot})`
    );
    process.exit(13);
  }

  const coordRoot =
    envResult.env['PACT_COMMUNITY_COORDINATION_ROOT'] ??
    path.join(workspaceRoot, 'coordination');

  let canonicalCoordRoot: string;
  try {
    canonicalCoordRoot = verifyCoordRoot(coordRoot);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[pact-community-coordination] ${(error as Error).message}`);
    process.exit(13);
  }

  const lockfilePath =
    resolveLockfilePath(import.meta.url, envResult.env['PACT_COMMUNITY_TOOLS_LOCKFILE']);

  verifyToolsLock(SERVER_NAME, getToolSchemaObjects(), lockfilePath);

  return {
    workspaceRoot,
    coordinationRoot: canonicalCoordRoot,
    lockfilePath
  };
}

export function buildMcpServer(config: ResolvedConfig): McpServer {
  const paths = createCoordPaths(config.coordinationRoot);
  return buildMcpServerWithPaths(config.workspaceRoot, paths);
}

export function buildMcpServerWithPaths(
  workspaceRoot: string,
  paths: CoordPaths
): McpServer {
  const auditLog = createAuditLogger(SERVER_NAME);

  const mcp = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  const handlers = buildHandlers(workspaceRoot, paths, auditLog);

  mcp.registerTool(
    'coord.task_create',
    {
      title: 'Create task',
      description: 'Create a new task in the coordination queue.',
      inputSchema: TaskCreateInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    (args) => wrap(auditLog, 'coord.task_create', args, () => handlers.taskCreate(args))
  );

  mcp.registerTool(
    'coord.task_list',
    {
      title: 'List tasks',
      description: 'List task summaries matching optional filters.',
      inputSchema: TaskListInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    (args) => wrap(auditLog, 'coord.task_list', args, () => handlers.taskList(args))
  );

  mcp.registerTool(
    'coord.task_get',
    {
      title: 'Get task',
      description: 'Fetch a single task by id.',
      inputSchema: TaskGetInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    (args) => wrap(auditLog, 'coord.task_get', args, () => handlers.taskGet(args))
  );

  mcp.registerTool(
    'coord.task_update',
    {
      title: 'Update task',
      description: 'Atomically update a task under a file lock.',
      inputSchema: TaskUpdateInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    (args) => wrap(auditLog, 'coord.task_update', args, () => handlers.taskUpdate(args))
  );

  mcp.registerTool(
    'coord.task_complete',
    {
      title: 'Complete task',
      description: 'Mark a task done; validate every artifact path exists.',
      inputSchema: TaskCompleteInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    (args) => wrap(auditLog, 'coord.task_complete', args, () => handlers.taskComplete(args))
  );

  mcp.registerTool(
    'coord.mailbox_send',
    {
      title: 'Send mailbox message',
      description: 'Append a message to the recipient agent inbox.',
      inputSchema: MailboxSendInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    (args) => wrap(auditLog, 'coord.mailbox_send', args, () => handlers.mailboxSend(args))
  );

  mcp.registerTool(
    'coord.mailbox_read',
    {
      title: 'Read mailbox',
      description: 'Read an inbox with optional filters. Non-mutating.',
      inputSchema: MailboxReadInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    (args) => wrap(auditLog, 'coord.mailbox_read', args, () => handlers.mailboxRead(args))
  );

  mcp.registerTool(
    'coord.mailbox_ack',
    {
      title: 'Acknowledge messages',
      description: 'Mark inbox messages as read.',
      inputSchema: MailboxAckInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    (args) => wrap(auditLog, 'coord.mailbox_ack', args, () => handlers.mailboxAck(args))
  );

  mcp.registerTool(
    'coord.status_set',
    {
      title: 'Set agent status',
      description: 'Write the agent status atomically.',
      inputSchema: StatusSetInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    (args) => wrap(auditLog, 'coord.status_set', args, () => handlers.statusSet(args))
  );

  mcp.registerTool(
    'coord.memory_append',
    {
      title: 'Append memory entry',
      description: 'Append a memory entry to a scoped JSONL log.',
      inputSchema: MemoryAppendInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    (args) => wrap(auditLog, 'coord.memory_append', args, () => handlers.memoryAppend(args))
  );

  return mcp;
}

export function getToolSchemaObjects(): Record<string, { inputSchema: object }> {
  return {
    'coord.task_create': { inputSchema: TaskCreateInputShape },
    'coord.task_list': { inputSchema: TaskListInputShape },
    'coord.task_get': { inputSchema: TaskGetInputShape },
    'coord.task_update': { inputSchema: TaskUpdateInputShape },
    'coord.task_complete': { inputSchema: TaskCompleteInputShape },
    'coord.mailbox_send': { inputSchema: MailboxSendInputShape },
    'coord.mailbox_read': { inputSchema: MailboxReadInputShape },
    'coord.mailbox_ack': { inputSchema: MailboxAckInputShape },
    'coord.status_set': { inputSchema: StatusSetInputShape },
    'coord.memory_append': { inputSchema: MemoryAppendInputShape }
  };
}

export interface ToolHandlers {
  taskCreate: (args: unknown) => Promise<{ content: unknown[] }>;
  taskList: (args: unknown) => Promise<{ content: unknown[] }>;
  taskGet: (args: unknown) => Promise<{ content: unknown[] }>;
  taskUpdate: (args: unknown) => Promise<{ content: unknown[] }>;
  taskComplete: (args: unknown) => Promise<{ content: unknown[] }>;
  mailboxSend: (args: unknown) => Promise<{ content: unknown[] }>;
  mailboxRead: (args: unknown) => Promise<{ content: unknown[] }>;
  mailboxAck: (args: unknown) => Promise<{ content: unknown[] }>;
  statusSet: (args: unknown) => Promise<{ content: unknown[] }>;
  memoryAppend: (args: unknown) => Promise<{ content: unknown[] }>;
}

export function buildHandlers(
  workspaceRoot: string,
  paths: CoordPaths,
  audit: AuditLogger
): ToolHandlers {
  return {
    taskCreate: createTaskCreateTool({ paths, workspaceRoot }),
    taskList: createTaskListTool({ paths, audit }),
    taskGet: createTaskGetTool({ paths, audit }),
    taskUpdate: createTaskUpdateTool({ paths, audit }),
    taskComplete: createTaskCompleteTool({ paths, workspaceRoot, audit }),
    mailboxSend: createMailboxSendTool({ paths }),
    mailboxRead: createMailboxReadTool({ paths, audit }),
    mailboxAck: createMailboxAckTool({ paths, audit }),
    statusSet: createStatusSetTool({ paths }),
    memoryAppend: createMemoryAppendTool({ paths, workspaceRoot })
  };
}

async function wrap(
  auditLog: AuditLogger,
  tool: string,
  args: unknown,
  fn: () => Promise<{ content: unknown[] }>
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    const payload = result.content[0];
    auditLog.log({
      tool,
      inputHash: hashArgs(args),
      exitStatus: 0,
      durationMs: Date.now() - startedAt
    });
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload) }]
    };
  } catch (error) {
    auditLog.log({
      tool,
      inputHash: hashArgs(args),
      exitStatus: errorCode(error),
      durationMs: Date.now() - startedAt
    });
    if (error instanceof McpToolError) throw error;
    if (error instanceof Error) {
      throw new McpToolError(ErrorCodes.OPERATION_FAILED, error.message, false);
    }
    throw new McpToolError(ErrorCodes.OPERATION_FAILED, 'unknown error', false);
  }
}

function hashArgs(args: unknown): string {
  try {
    return (
      'args:' +
      Buffer.from(JSON.stringify(args ?? null))
        .toString('base64')
        .slice(0, 32)
    );
  } catch {
    return 'args:unhashable';
  }
}

function errorCode(error: unknown): string | number {
  if (error instanceof McpToolError) return error.code;
  return 1;
}
