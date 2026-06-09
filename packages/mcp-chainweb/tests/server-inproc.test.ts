/**
 * @fileoverview In-process server invocation via InMemoryTransport.
 *               Exercises the tool-registration / wrap() code paths
 *               inside server.ts for coverage + functional correctness.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { buildMcpServerWithClient } from '../src/server.js';
import { createChainwebClient } from '../src/client/fetch.js';
import {
  startMockChainweb,
  type MockHandle
} from './fixtures/mock-chainweb.js';

describe('server in-process wrap()', () => {
  let mock: MockHandle;
  let mcpClient: Client;

  beforeAll(async () => {
    mock = await startMockChainweb();
    const httpClient = createChainwebClient({
      baseUrl: mock.baseUrl,
      networkId: 'development',
      allowedOrigins: [],
      additionalAllowedOrigins: [mock.origin]
    });
    const server = buildMcpServerWithClient(httpClient);

    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    // McpServer exposes .connect(transport); lower-level wrapper.
    await (server as unknown as {
      connect: (t: unknown) => Promise<void>;
    }).connect(serverT);

    mcpClient = new Client(
      { name: 'inproc', version: '0' },
      { capabilities: {} }
    );
    await mcpClient.connect(clientT);
  });

  afterAll(async () => {
    if (mcpClient) await mcpClient.close();
    if (mock) await mock.close();
  });

  test('tools/list returns 11 tools', async () => {
    const { tools } = await mcpClient.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
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
  });

  test('info call succeeds end-to-end', async () => {
    const res = await mcpClient.callTool({
      name: 'chainweb.info',
      arguments: {}
    });
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(
      (res.content as Array<{ text: string }>)[0]!.text
    );
    expect(parsed.networkId).toBe('development');
  });

  test('chain_time call succeeds', async () => {
    const res = await mcpClient.callTool({
      name: 'chainweb.chain_time',
      arguments: { chainId: '0' }
    });
    expect(res.isError).toBeFalsy();
  });

  test('local failure sets isError:true on response', async () => {
    mock.patch('local', {
      reqKey: 'x',
      result: { status: 'failure', error: { message: 'oops' } },
      gas: 0
    });
    const res = await mcpClient.callTool({
      name: 'chainweb.local',
      arguments: { chainId: '0', code: '(fail)' }
    });
    expect(res.isError).toBe(true);
    mock.patch('local', undefined);
  });

  test('send happy path returns requestKey', async () => {
    mock.patch('local', {
      reqKey: 'pre',
      result: { status: 'success', data: true },
      gas: 1
    });
    mock.patch('send', { requestKeys: ['rk-ok'] });
    const res = await mcpClient.callTool({
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
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(
      (res.content as Array<{ text: string }>)[0]!.text
    );
    expect(parsed.requestKey).toBe('rk-ok');
    mock.patch('local', undefined);
    mock.patch('send', undefined);
  });

  test('poll call succeeds', async () => {
    const res = await mcpClient.callTool({
      name: 'chainweb.poll',
      arguments: {
        chainId: '0',
        requestKeys: ['abc'],
        timeoutMs: 5_000,
        intervalMs: 250
      }
    });
    expect(res.isError).toBeFalsy();
  });

  test('tool that throws McpToolError is reported via isError', async () => {
    mock.patch('info', { networkId: 'mainnet01', chainIds: [] });
    const res = await mcpClient.callTool({
      name: 'chainweb.info',
      arguments: {}
    });
    expect(res.isError).toBe(true);
    mock.patch('info', undefined);
  });
});
