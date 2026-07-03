/**
 * Regenerate tools.lock.json from all servers' live schemas.
 *
 * Writes the workspace lockfile at the repo root (all servers) plus a
 * per-package lockfile next to each server (shipped with the npm package so
 * published binaries can verify schemas from any working directory).
 *
 * Usage: pnpm build && node scripts/regen-lockfile.mjs
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
const repoRoot = path.resolve(here, '..');

const servers = [
  { module: pactServer, pkg: 'mcp-pact' },
  { module: chainwebServer, pkg: 'mcp-chainweb' },
  { module: coordServer, pkg: 'mcp-coordination' },
  { module: devnetServer, pkg: 'mcp-devnet' }
];

const workspaceLock = { version: 1, servers: {} };

for (const { module: s, pkg } of servers) {
  const tools = s.getToolSchemaObjects();
  const entry = generateToolsLockEntry(s.SERVER_NAME, tools, s.SERVER_VERSION, '1.29.0');
  const serverTools = entry[s.SERVER_NAME].tools;
  workspaceLock.servers[s.SERVER_NAME] = serverTools;

  const packageLock = { version: 1, servers: { [s.SERVER_NAME]: serverTools } };
  const packageTarget = path.join(repoRoot, 'packages', pkg, 'tools.lock.json');
  fs.writeFileSync(packageTarget, JSON.stringify(packageLock, null, 2) + '\n', 'utf-8');
  console.log('Wrote', packageTarget);
}

const workspaceTarget = path.join(repoRoot, 'tools.lock.json');
fs.writeFileSync(workspaceTarget, JSON.stringify(workspaceLock, null, 2) + '\n', 'utf-8');
console.log('Wrote', workspaceTarget);
