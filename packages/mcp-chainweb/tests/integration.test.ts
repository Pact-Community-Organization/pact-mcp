/**
 * @fileoverview End-to-end integration test — spawns dist/bin.js via
 *               StdioClientTransport and exercises tools/list + tools/call
 *               against an in-process mock chainweb server.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { generateToolsLockEntry } from '@pact-community/mcp-shared';
import {
  SERVER_NAME,
  SERVER_VERSION,
  getToolSchemaObjects
} from '../src/server.js';
import {
  startMockChainweb,
  type MockHandle
} from './fixtures/mock-chainweb.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.resolve(here, '../dist/bin.js');

function buildLockfile(): string {
  const lockDir = fs.mkdtempSync(
    path.join(process.env['TMPDIR'] ?? '/tmp', 'mcp-chainweb-intg-')
  );
  const lockPath = path.join(lockDir, 'tools.lock.json');
  const tools = getToolSchemaObjects();
  const entry = (generateToolsLockEntry(
    SERVER_NAME,
    tools,
    SERVER_VERSION,
    '1.18.0'
  ) as Record<string, { tools: Record<string, unknown> }>)[SERVER_NAME]!;
  fs.writeFileSync(
    lockPath,
    JSON.stringify(
      { version: 1, servers: { [SERVER_NAME]: entry.tools } },
      null,
      2
    )
  );
  return lockPath;
}

describe('MCP chainweb server — integration', () => {
  let client: Client;
  let transport: StdioClientTransport;
  let mock: MockHandle;

  beforeAll(async () => {
    if (!fs.existsSync(binPath)) {
      throw new Error(
        `Binary not built: ${binPath}. Run 'pnpm --filter @pact-community/mcp-chainweb build' first.`
      );
    }

    mock = await startMockChainweb();
    const lockPath = buildLockfile();
    const tempRoot = fs.mkdtempSync(
      path.join(process.env['TMPDIR'] ?? '/tmp', 'mcp-chainweb-root-')
    );

    transport = new StdioClientTransport({
      command: 'node',
      args: [binPath],
      env: {
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
        HOME: process.env['HOME'] ?? '/tmp',
        NODE_ENV: 'test',
        PACT_COMMUNITY_WORKSPACE_ROOT: tempRoot,
        PACT_COMMUNITY_CHAINWEB_MODE: 'devnet',
        PACT_COMMUNITY_CHAINWEB_BASE_URL: mock.baseUrl,
        PACT_COMMUNITY_CHAINWEB_NETWORK_ID: 'development',
        PACT_COMMUNITY_TOOLS_LOCKFILE: lockPath,
        PACT_COMMUNITY_TEST_ALLOW_ORIGINS: mock.origin
      }
    });

    client = new Client(
      { name: 'test-client', version: '0.0.0' },
      { capabilities: {} }
    );
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    if (client) await client.close();
    if (mock) await mock.close();
  });

  test('tools/list returns exactly the 11 v0.2 tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'chainweb.chain_time',
      'chainweb.continue_pact',
      'chainweb.deploy_module',
      'chainweb.info',
      'chainweb.keys',
      'chainweb.local',
      'chainweb.poll',
      'chainweb.principal_namespace',
      'chainweb.read_table',
      'chainweb.send',
      'chainweb.spv_proof'
    ]);
    for (const t of tools) {
      expect(t.inputSchema).toBeDefined();
      expect(t.description).toBeTruthy();
    }
  });

  test('tools/call chainweb.info returns devnet data', async () => {
    const result = await client.callTool({
      name: 'chainweb.info',
      arguments: {}
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    const parsed = JSON.parse(text);
    expect(parsed.networkId).toBe('development');
    expect(Array.isArray(parsed.chainIds)).toBe(true);
    expect(parsed.chainIds.length).toBeGreaterThan(0);
  });

  test('tools/call chainweb.chain_time returns creationTimeSec', async () => {
    const result = await client.callTool({
      name: 'chainweb.chain_time',
      arguments: { chainId: '0' }
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0]!.text
    );
    expect(typeof parsed.creationTimeSec).toBe('number');
    expect(parsed.creationTimeSec).toBeGreaterThan(1_000_000_000);
    expect(typeof parsed.blockHash).toBe('string');
  });

  test('tools/call chainweb.local unwraps Pact types', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: {
        status: 'success',
        data: { answer: { int: '42' }, weight: { decimal: '7.5' } }
      },
      gas: 10,
      logs: 'log-hash'
    });
    const result = await client.callTool({
      name: 'chainweb.local',
      arguments: { chainId: '0', code: '(+ 1 2)' }
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0]!.text
    );
    expect(parsed.status).toBe('success');
    expect(parsed.result).toEqual({ answer: 42, weight: '7.5' });
    expect(parsed.gasUsed).toBe(10);
    mock.patch('local', undefined);
  });

  test('tools/call chainweb.send runs preflight then /send', async () => {
    mock.patch('local', {
      reqKey: 'pre',
      result: { status: 'success', data: true },
      gas: 5
    });
    mock.patch('send', { requestKeys: ['abc123'] });
    const result = await client.callTool({
      name: 'chainweb.send',
      arguments: {
        chainId: '0',
        signedTx: {
          cmd: '{"networkId":"development"}',
          hash: 'h',
          sigs: [{ sig: 'a'.repeat(128) }]
        }
      }
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0]!.text
    );
    expect(parsed.requestKey).toBe('abc123');
    expect(parsed.preflight.ok).toBe(true);
    mock.patch('local', undefined);
    mock.patch('send', undefined);
  });

  test('tools/call chainweb.poll returns unwrapped results', async () => {
    mock.patch('poll', {
      rk1: {
        reqKey: 'rk1',
        result: { status: 'success', data: { int: '7' } },
        gas: 3,
        metaData: { blockHeight: 42, blockHash: 'bh' }
      }
    });
    const result = await client.callTool({
      name: 'chainweb.poll',
      arguments: {
        chainId: '0',
        requestKeys: ['rk1'],
        timeoutMs: 10_000,
        intervalMs: 250
      }
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0]!.text
    );
    expect(parsed.complete).toBe(true);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].status).toBe('success');
    expect(parsed.results[0].result).toBe(7);
    mock.patch('poll', undefined);
  });

  test('tools/call chainweb.local with failure surfaces isError', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: {
        status: 'failure',
        error: { message: 'boom' }
      },
      gas: 0
    });
    const result = await client.callTool({
      name: 'chainweb.local',
      arguments: { chainId: '0', code: '(fail)' }
    });
    expect(result.isError).toBe(true);
    mock.patch('local', undefined);
  });

  test('tools/call chainweb.read_table returns unwrapped row', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: {
        status: 'success',
        data: { balance: { decimal: '10.5' }, votes: { int: '3' } }
      },
      gas: 50
    });
    const result = await client.callTool({
      name: 'chainweb.read_table',
      arguments: {
        chainId: '0',
        module: 'n_abc.dao-token',
        table: 'accounts',
        key: 'alice'
      }
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0]!.text
    );
    expect(parsed.keyFound).toBe(true);
    expect(parsed.row).toEqual({ balance: '10.5', votes: 3 });
    mock.patch('local', undefined);
  });

  test('tools/call chainweb.keys returns string array', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: { status: 'success', data: ['alice', 'bob'] },
      gas: 10
    });
    const result = await client.callTool({
      name: 'chainweb.keys',
      arguments: {
        chainId: '0',
        module: 'n_abc.dao-token',
        table: 'accounts',
        limit: 100
      }
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0]!.text
    );
    expect(parsed.keys).toEqual(['alice', 'bob']);
    expect(parsed.hasMore).toBe(false);
    mock.patch('local', undefined);
  });

  test('tools/call chainweb.principal_namespace returns namespace', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: {
        status: 'success',
        data: '<namespace-principal>'
      },
      gas: 5
    });
    const result = await client.callTool({
      name: 'chainweb.principal_namespace',
      arguments: {
        chainId: '0',
        keyset: {
          keys: [
            '368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43cca'
          ],
          pred: 'keys-all'
        }
      }
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0]!.text
    );
    expect(parsed.namespace).toBe(
      '<namespace-principal>'
    );
    mock.patch('local', undefined);
  });

  test('tools/call chainweb.deploy_module preflight-only path', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: { status: 'success', data: 'Loaded' },
      gas: 2_000
    });
    const result = await client.callTool({
      name: 'chainweb.deploy_module',
      arguments: {
        chainId: '0',
        module: { code: '(module demo GOVERNANCE (defcap GOVERNANCE () true))' },
        signerKey:
          '368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43cca'
      }
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0]!.text
    );
    expect(parsed.deployed).toBe(false);
    expect(parsed.preflight.ok).toBe(true);
    expect(parsed.unsignedTx).toBeDefined();
    mock.patch('local', undefined);
  });

  test('tools/call chainweb.continue_pact preflight-only path', async () => {
    mock.patch('localCont', {
      reqKey: 'rk',
      result: { status: 'success', data: 'step ok' },
      gas: 1_000
    });
    const result = await client.callTool({
      name: 'chainweb.continue_pact',
      arguments: {
        pactId: 'pact-id-abc',
        step: 1,
        targetChainId: '1',
        proof: 'eyJwcm9vZiI6ImJhc2U2NCJ9',
        signerKey:
          '368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43cca'
      }
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0]!.text
    );
    expect(parsed.submitted).toBe(false);
    expect(parsed.preflight.ok).toBe(true);
    mock.patch('localCont', undefined);
  });

  test('tools/call chainweb.spv_proof returns ready=true with proof', async () => {
    mock.patch('spv', 'eyJwcm9vZiI6ImJhc2U2NCJ9');
    const result = await client.callTool({
      name: 'chainweb.spv_proof',
      arguments: {
        sourceChainId: '0',
        targetChainId: '1',
        requestKey: 'req-key-abc'
      }
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0]!.text
    );
    expect(parsed.ready).toBe(true);
    expect(parsed.proof).toBe('eyJwcm9vZiI6ImJhc2U2NCJ9');
    mock.patch('spv', undefined);
  });
});
