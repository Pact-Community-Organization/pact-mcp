/**
 * @fileoverview Tests for chainweb.read_table.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createChainwebClient } from '../../src/client/fetch.js';
import { createReadTableTool } from '../../src/tools/read-table.js';
import {
  startMockChainweb,
  type MockHandle
} from '../fixtures/mock-chainweb.js';

describe('chainweb.read_table', () => {
  let mock: MockHandle;

  beforeAll(async () => {
    mock = await startMockChainweb();
  });
  afterAll(async () => {
    await mock.close();
  });

  function makeClient() {
    return createChainwebClient({
      baseUrl: mock.baseUrl,
      networkId: 'development',
      allowedOrigins: [],
      additionalAllowedOrigins: [mock.origin]
    });
  }

  test('returns unwrapped row on success', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: {
        status: 'success',
        data: {
          balance: { decimal: '1234.5' },
          votes: { int: '7' },
          address: 'alice'
        }
      },
      gas: 50
    });
    const tool = createReadTableTool({ client: makeClient() });
    const { content } = await tool({
      chainId: '0',
      module: 'n_abc.dao-token',
      table: 'accounts',
      key: 'alice'
    });
    expect(content[0]!.keyFound).toBe(true);
    expect(content[0]!.row).toEqual({
      balance: '1234.5',
      votes: 7,
      address: 'alice'
    });
    expect(content[0]!.gasUsed).toBe(50);
    expect(content[0]!.truncated).toBe(false);
  });

  test('row not found → keyFound=false, no error', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: {
        status: 'failure',
        error: { message: 'row not found in table accounts' }
      },
      gas: 5
    });
    const tool = createReadTableTool({ client: makeClient() });
    const { content } = await tool({
      chainId: '0',
      module: 'n_abc.dao-token',
      table: 'accounts',
      key: 'unknown-user'
    });
    expect(content[0]!.keyFound).toBe(false);
    expect(content[0]!.row).toBeNull();
  });

  test('other Pact errors throw READ_TABLE_FAILED', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: {
        status: 'failure',
        error: { message: 'module not found: n_abc.nope' }
      },
      gas: 0
    });
    const tool = createReadTableTool({ client: makeClient() });
    await expect(
      tool({
        chainId: '0',
        module: 'n_abc.nope',
        table: 'accounts',
        key: 'alice'
      })
    ).rejects.toMatchObject({ code: 'READ_TABLE_FAILED' });
  });

  test('truncates rows >1MB', async () => {
    const big = 'x'.repeat(1_200_000);
    mock.patch('local', {
      reqKey: 'rk',
      result: { status: 'success', data: { blob: big } },
      gas: 1
    });
    const tool = createReadTableTool({ client: makeClient() });
    const { content } = await tool({
      chainId: '0',
      module: 'n_abc.dao-token',
      table: 'accounts',
      key: 'alice'
    });
    expect(content[0]!.truncated).toBe(true);
    expect(content[0]!.row).toBeNull();
    expect(content[0]!.keyFound).toBe(true);
  });

  test('composes (read module.table "key") correctly', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: { status: 'success', data: { x: 1 } },
      gas: 1
    });
    const before = mock.requests.length;
    const tool = createReadTableTool({ client: makeClient() });
    await tool({
      chainId: '0',
      module: 'n_abc.dao-token',
      table: 'accounts',
      key: 'alice'
    });
    const last = mock.requests.slice(before).find((r) =>
      /\/local/.test(r.url)
    );
    expect(last).toBeDefined();
    const parsed = JSON.parse(last!.body) as { cmd: string };
    const inner = JSON.parse(parsed.cmd) as {
      payload: { exec: { code: string } };
    };
    expect(inner.payload.exec.code).toBe(
      '(read n_abc.dao-token.accounts "alice")'
    );
  });
});
