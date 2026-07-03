#!/usr/bin/env node
/**
 * @fileoverview MCP Devnet server binary.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer, resolveConfig } from './server.js';

async function main(): Promise<void> {
  const config = resolveConfig();
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
  console.error('[pact-community-devnet] fatal:', error);
  process.exit(1);
});
