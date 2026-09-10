#!/usr/bin/env node
/**
 * @fileoverview MCP Pact server binary - Supports Stdio MCP & HTTP REST API modes.
 */

import process from 'node:process';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer, resolveConfig, createHttpServer } from './server.js';

async function main(): Promise<void> {
  const config = resolveConfig();
  const args = process.argv.slice(2);
  const isHttp = args.includes('--http') || Boolean(process.env.PACT_MCP_HTTP_PORT);

  if (isHttp) {
    let port = 3846;
    const httpIdx = args.indexOf('--http');
    if (httpIdx !== -1) {
      const nextArg = args[httpIdx + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        port = parseInt(nextArg, 10) || 3846;
      }
    } else if (process.env.PACT_MCP_HTTP_PORT) {
      port = parseInt(process.env.PACT_MCP_HTTP_PORT, 10) || 3846;
    }

    const httpServer = createHttpServer(config);
    httpServer.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`[pact-community-pact] HTTP REST API server listening on http://0.0.0.0:${port}`);
      // eslint-disable-next-line no-console
      console.log(`[pact-community-pact] Health check: http://localhost:${port}/v1/health`);
      // eslint-disable-next-line no-console
      console.log(`[pact-community-pact] Security Rules: http://localhost:${port}/v1/prover/rules`);
      // eslint-disable-next-line no-console
      console.log(`[pact-community-pact] Prover Verification: POST http://localhost:${port}/v1/prover/verify`);
      // eslint-disable-next-line no-console
      console.log(`[pact-community-pact] A2A Self-Healing: POST http://localhost:${port}/v1/prover/heal`);
    });

    const shutdown = async (): Promise<void> => {
      httpServer.close(() => {
        process.exit(0);
      });
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
    return;
  }

  // Default Stdio MCP transport
  const mcp = buildMcpServer(config);
  const transport = new StdioServerTransport();
  await mcp.connect(transport);

  const shutdown = async (): Promise<void> => {
    try {
      await mcp.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[pact-community-pact] fatal:', error);
  process.exit(1);
});
