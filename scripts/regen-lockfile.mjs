/**
 * [Developer] Regenerate mcp/tools.lock.json from ALL servers' live schemas.
 * Usage: node scripts/regen-lockfile.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateToolsLockEntry } from '../packages/mcp-shared/dist/lockfile.js';
import * as pactServer from '../packages/mcp-pact/dist/server.js';
import * as chainwebServer from '../packages/mcp-chainweb/dist/server.js';
import * as coordServer from '../packages/mcp-coordination/dist/server.js';
import * as devnetServer from '../packages/mcp-devnet/dist/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '..', 'tools.lock.json');

const servers = [pactServer, chainwebServer, coordServer, devnetServer];

const lock = { version: 1, servers: {} };

for (const s of servers) {
  const tools = s.getToolSchemaObjects();
  const entry = generateToolsLockEntry(s.SERVER_NAME, tools, s.SERVER_VERSION, '1.29.0');
  const serverTools = entry[s.SERVER_NAME].tools;
  lock.servers[s.SERVER_NAME] = serverTools;
}

fs.writeFileSync(target, JSON.stringify(lock, null, 2) + '\n', 'utf-8');
console.log('Wrote', target);

