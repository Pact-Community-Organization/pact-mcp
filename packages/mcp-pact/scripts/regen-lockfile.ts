/**
 * @fileoverview Regenerate the pact-community-pact entries in tools.lock.json
 *               while preserving chainweb + coordination entries verbatim.
 * @author Developer
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateToolsLockEntry } from '@pact-community/mcp-shared';
import {
  SERVER_NAME,
  SERVER_VERSION,
  getToolSchemaObjects
} from '../src/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const lockPath = path.resolve(here, '../../../tools.lock.json');

const existing = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as {
  version: number;
  servers: Record<string, Record<string, unknown>>;
};

const tools = getToolSchemaObjects();
const entry = (generateToolsLockEntry(
  SERVER_NAME,
  tools,
  SERVER_VERSION,
  '1.29.0'
) as Record<string, { tools: Record<string, unknown> }>)[SERVER_NAME]!;

existing.servers[SERVER_NAME] = entry.tools;

fs.writeFileSync(lockPath, JSON.stringify(existing, null, 2) + '\n');
console.log(
  `Regenerated ${SERVER_NAME} entries: ${Object.keys(entry.tools).length} tools`
);
