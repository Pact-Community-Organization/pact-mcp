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

  const SIGNER_KEY =
    '368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43cca';

  function parsePayload(res: unknown): Record<string, unknown> {
    return JSON.parse(
      ((res as { content: Array<{ text: string }> }).content)[0]!.text
    ) as Record<string, unknown>;
  }

  test('read_table returns the unwrapped row', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: {
        status: 'success',
        data: { balance: { decimal: '1234.5' }, address: 'alice' }
      },
      gas: 50
    });
    const res = await mcpClient.callTool({
      name: 'chainweb.read_table',
      arguments: {
        chainId: '0',
        module: 'n_abc.dao-token',
        table: 'accounts',
        key: 'alice'
      }
    });
    expect(res.isError).toBeFalsy();
    expect(parsePayload(res)['keyFound']).toBe(true);
    mock.patch('local', undefined);
  });

  test('keys lists table keys', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: { status: 'success', data: ['alice', 'bob', 'carol'] },
      gas: 20
    });
    const res = await mcpClient.callTool({
      name: 'chainweb.keys',
      arguments: { chainId: '0', module: 'n_abc.dao-token', table: 'accounts' }
    });
    expect(res.isError).toBeFalsy();
    expect((parsePayload(res)['keys'] as string[]).length).toBe(3);
    mock.patch('local', undefined);
  });

  test('principal_namespace computes the n_ name', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: {
        status: 'success',
        data: 'n_0123456789abcdef0123456789abcdef01234567'
      },
      gas: 100
    });
    const res = await mcpClient.callTool({
      name: 'chainweb.principal_namespace',
      arguments: {
        chainId: '0',
        keyset: { keys: [SIGNER_KEY], pred: 'keys-all' }
      }
    });
    expect(res.isError).toBeFalsy();
    expect(parsePayload(res)['namespace']).toBe(
      'n_0123456789abcdef0123456789abcdef01234567'
    );
    mock.patch('local', undefined);
  });

  test('deploy_module preflight-only returns an unsigned tx', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: { status: 'success', data: 'Loaded module demo' },
      gas: 12_000
    });
    const res = await mcpClient.callTool({
      name: 'chainweb.deploy_module',
      arguments: {
        chainId: '0',
        module: {
          code: '(module demo GOVERNANCE\n  (defcap GOVERNANCE () true)\n  (defun hello () "world"))'
        },
        signerKey: SIGNER_KEY
      }
    });
    expect(res.isError).toBeFalsy();
    const payload = parsePayload(res);
    expect(payload['deployed']).toBe(false);
    expect(payload['unsignedTx']).toBeDefined();
    mock.patch('local', undefined);
  });

  test('continue_pact preflight-only returns an unsigned tx', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: { status: 'success', data: 'continued' },
      gas: 8_000
    });
    const res = await mcpClient.callTool({
      name: 'chainweb.continue_pact',
      arguments: {
        pactId: 'pact-id-abc',
        step: 1,
        rollback: false,
        targetChainId: '1',
        proof: 'eyJwcm9vZiI6ImJhc2U2NCJ9',
        signerKey: SIGNER_KEY
      }
    });
    expect(res.isError).toBeFalsy();
    const payload = parsePayload(res);
    expect(payload['submitted']).toBe(false);
    expect(payload['unsignedTx']).toBeDefined();
    mock.patch('local', undefined);
  });

  test('spv_proof returns a ready proof', async () => {
    const res = await mcpClient.callTool({
      name: 'chainweb.spv_proof',
      arguments: {
        sourceChainId: '0',
        targetChainId: '1',
        requestKey: 'req-key-abc'
      }
    });
    expect(res.isError).toBeFalsy();
    expect(parsePayload(res)['ready']).toBe(true);
  });

  test('write tools are blocked on public profiles with PROFILE_WRITE_BLOCKED', async () => {
    const httpClient = createChainwebClient({
      baseUrl: mock.baseUrl,
      networkId: 'mainnet01',
      allowedOrigins: [],
      additionalAllowedOrigins: [mock.origin]
    });
    const server = buildMcpServerWithClient(httpClient, {
      profile: 'mainnet',
      writesEnabled: false
    });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await (server as unknown as {
      connect: (t: unknown) => Promise<void>;
    }).connect(serverT);

    const readonlyClient = new Client(
      { name: 'readonly-inproc', version: '0' },
      { capabilities: {} }
    );
    await readonlyClient.connect(clientT);

    const res = await readonlyClient.callTool({
      name: 'chainweb.send',
      arguments: {
        chainId: '0',
        signedTx: {
          cmd: '{"networkId":"mainnet01"}',
          hash: 'h',
          sigs: [{ sig: 'a'.repeat(128) }]
        }
      }
    });

    expect(res.isError).toBe(true);
    const payloadText = (res.content as Array<{ text: string }>)[0]!.text;
    expect(payloadText).toContain('PROFILE_WRITE_BLOCKED');

    await readonlyClient.close();
    await server.close();
  });
});
