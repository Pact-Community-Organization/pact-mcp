import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const runDevnetE2E = process.env['PACT_COMMUNITY_ENABLE_DEVNET_E2E'] === 'true';
const runSendPoll = process.env['PACT_COMMUNITY_ENABLE_DEVNET_E2E_SEND_POLL'] === 'true';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..', '..');
const binPath = path.resolve(packageRoot, 'dist/bin.js');
const repoRoot = path.resolve(packageRoot, '..', '..');
const lockfilePath = path.resolve(repoRoot, 'tools.lock.json');
const describeIf = runDevnetE2E ? describe : describe.skip;

describeIf('devnet e2e lane (opt-in)', () => {
  let client: Client;

  beforeAll(async () => {
    if (!fs.existsSync(binPath)) {
      throw new Error(`Binary not built: ${binPath}. Run pnpm build first.`);
    }
    if (!fs.existsSync(lockfilePath)) {
      throw new Error(`Missing lockfile: ${lockfilePath}`);
    }

    const workspaceRoot = process.env['PACT_COMMUNITY_WORKSPACE_ROOT'] ?? repoRoot;
    const baseUrl = process.env['PACT_COMMUNITY_CHAINWEB_BASE_URL'] ?? 'http://localhost:8081';
    const networkId = process.env['PACT_COMMUNITY_CHAINWEB_NETWORK_ID'] ?? 'development';

    const transport = new StdioClientTransport({
      command: 'node',
      args: [binPath],
      env: {
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
        HOME: process.env['HOME'] ?? '/tmp',
        NODE_ENV: 'test',
        PACT_COMMUNITY_WORKSPACE_ROOT: workspaceRoot,
        PACT_COMMUNITY_CHAINWEB_MODE: 'devnet',
        PACT_COMMUNITY_CHAINWEB_PROFILE: 'devnet',
        PACT_COMMUNITY_CHAINWEB_BASE_URL: baseUrl,
        PACT_COMMUNITY_CHAINWEB_NETWORK_ID: networkId,
        PACT_COMMUNITY_TOOLS_LOCKFILE: lockfilePath
      }
    });

    client = new Client({ name: 'devnet-e2e-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    if (client) await client.close();
  });

  test('info + local + keys prove read-path against a live devnet', async () => {
    const info = await client.callTool({ name: 'chainweb.info', arguments: {} });
    expect(info.isError).toBeFalsy();
    const infoPayload = JSON.parse((info.content as Array<{ text: string }>)[0]!.text);
    expect(infoPayload.networkId).toBe('development');
    expect(Array.isArray(infoPayload.chainIds)).toBe(true);

    const local = await client.callTool({
      name: 'chainweb.local',
      arguments: {
        chainId: '0',
        code: '(+ 1 2)'
      }
    });
    expect(local.isError).toBeFalsy();
    const localPayload = JSON.parse((local.content as Array<{ text: string }>)[0]!.text);
    expect(localPayload.status).toBe('success');

    const keys = await client.callTool({
      name: 'chainweb.keys',
      arguments: {
        chainId: '0',
        module: 'coin',
        table: 'coin-table',
        limit: 10
      }
    });
    expect(keys.isError).toBeFalsy();
    const keysPayload = JSON.parse((keys.content as Array<{ text: string }>)[0]!.text);
    expect(Array.isArray(keysPayload.keys)).toBe(true);
    expect(typeof keysPayload.hasMore).toBe('boolean');
  }, 60_000);

  test('optional send+poll proof path when fixture tx is provided', async () => {
    if (!runSendPoll) {
      return;
    }

    const fixture = process.env['PACT_COMMUNITY_DEVNET_SIGNED_TX_JSON'];
    if (!fixture || !fs.existsSync(fixture)) {
      throw new Error(
        'PACT_COMMUNITY_ENABLE_DEVNET_E2E_SEND_POLL=true requires PACT_COMMUNITY_DEVNET_SIGNED_TX_JSON to point to a signed tx fixture.'
      );
    }

    const parsed = JSON.parse(fs.readFileSync(fixture, 'utf-8')) as {
      chainId?: string;
      signedTx: { cmd: string; hash: string; sigs: Array<{ sig: string | null }> };
    };

    const chainId = parsed.chainId ?? '0';
    const send = await client.callTool({
      name: 'chainweb.send',
      arguments: {
        chainId,
        signedTx: parsed.signedTx
      }
    });
    expect(send.isError).toBeFalsy();
    const sendPayload = JSON.parse((send.content as Array<{ text: string }>)[0]!.text);
    expect(typeof sendPayload.requestKey).toBe('string');

    const poll = await client.callTool({
      name: 'chainweb.poll',
      arguments: {
        chainId,
        requestKeys: [sendPayload.requestKey],
        timeoutMs: 60_000,
        intervalMs: 2_000
      }
    });
    expect(poll.isError).toBeFalsy();
    const pollPayload = JSON.parse((poll.content as Array<{ text: string }>)[0]!.text);
    expect(Array.isArray(pollPayload.results)).toBe(true);
  }, 120_000);
});
