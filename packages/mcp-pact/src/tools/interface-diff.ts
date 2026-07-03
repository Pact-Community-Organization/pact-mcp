/**
 * @fileoverview pact.interface_diff tool implementation
 * @description Compare two .pact files and report public-API changes
 *              (added/removed/changed/unchanged). Uses a conservative
 *              balanced-paren extractor from src/analysis/interface.ts.
 */

import fs from 'node:fs';
import { z } from 'zod';
import {
  resolveInsideWorkspace,
  sanitizeToolOutput,
  McpToolError
} from '@pact-community/mcp-shared';
import {
  extractInterface,
  type PactSymbol,
  type SymbolKind
} from '../analysis/interface.js';

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

export const InterfaceDiffInputShape = {
  before: z
    .string()
    .min(1)
    .describe('Workspace-relative path to the BEFORE .pact file.'),
  after: z
    .string()
    .min(1)
    .describe('Workspace-relative path to the AFTER .pact file.')
};

export const InterfaceDiffInputSchema = z.object(InterfaceDiffInputShape);

export interface DiffSymbol {
  kind: SymbolKind;
  name: string;
  signature: string;
}

export interface InterfaceDiffResult {
  moduleName: { before: string | null; after: string | null };
  added: DiffSymbol[];
  removed: DiffSymbol[];
  changed: Array<{ name: string; kind: SymbolKind; before: DiffSymbol; after: DiffSymbol }>;
  unchanged: DiffSymbol[];
  breakingChange: boolean;
  parseWarnings: string[];
}

export interface InterfaceDiffToolConfig {
  workspaceRoot: string;
}

export function createInterfaceDiffTool(config: InterfaceDiffToolConfig) {
  return async function interfaceDiff(
    args: unknown
  ): Promise<{ content: InterfaceDiffResult[] }> {
    const input = InterfaceDiffInputSchema.parse(args);

    const beforeSrc = readBounded(config.workspaceRoot, input.before);
    const afterSrc = readBounded(config.workspaceRoot, input.after);

    const beforeExtract = extractInterface(beforeSrc);
    const afterExtract = extractInterface(afterSrc);

    const warnings = [
      ...beforeExtract.parseWarnings.map((w) => `[before] ${w}`),
      ...afterExtract.parseWarnings.map((w) => `[after] ${w}`)
    ].map((w) => sanitizeToolOutput(w).text);

    if (
      beforeExtract.symbols.length === 0 &&
      afterExtract.symbols.length === 0
    ) {
      throw new McpToolError(
        'UNPARSEABLE_PACT',
        'interface_diff could not extract any symbols from either file',
        false
      );
    }

    const beforeIndex = indexByKindName(beforeExtract.symbols);
    const afterIndex = indexByKindName(afterExtract.symbols);

    const added: DiffSymbol[] = [];
    const removed: DiffSymbol[] = [];
    const changed: InterfaceDiffResult['changed'] = [];
    const unchanged: DiffSymbol[] = [];

    const allKeys = new Set<string>([
      ...beforeIndex.keys(),
      ...afterIndex.keys()
    ]);

    for (const key of allKeys) {
      const b = beforeIndex.get(key);
      const a = afterIndex.get(key);
      if (b && !a) {
        removed.push(toDiffSymbol(b));
      } else if (!b && a) {
        added.push(toDiffSymbol(a));
      } else if (b && a) {
        if (normalizeSignature(b.signature) === normalizeSignature(a.signature)) {
          unchanged.push(toDiffSymbol(a));
        } else {
          changed.push({
            name: a.name,
            kind: a.kind,
            before: toDiffSymbol(b),
            after: toDiffSymbol(a)
          });
        }
      }
    }

    const breakingChange = removed.length > 0 || changed.length > 0;

    const result: InterfaceDiffResult = {
      moduleName: {
        before: beforeExtract.moduleName,
        after: afterExtract.moduleName
      },
      added: sortSymbols(added),
      removed: sortSymbols(removed),
      changed: changed.sort((x, y) => x.name.localeCompare(y.name)),
      unchanged: sortSymbols(unchanged),
      breakingChange,
      parseWarnings: warnings
    };

    return { content: [result] };
  };
}

function readBounded(workspaceRoot: string, userPath: string): string {
  if (!userPath.endsWith('.pact')) {
    throw new McpToolError(
      'INVALID_FILE_TYPE',
      `File must have .pact extension: ${userPath}`,
      false
    );
  }
  const resolved = resolveInsideWorkspace(workspaceRoot, userPath);
  if (!fs.existsSync(resolved)) {
    throw new McpToolError(
      'FILE_NOT_FOUND',
      `Pact file not found: ${userPath}`,
      false
    );
  }
  const stat = fs.statSync(resolved);
  if (stat.size > MAX_SOURCE_BYTES) {
    throw new McpToolError(
      'FILE_TOO_LARGE',
      `Pact file exceeds ${MAX_SOURCE_BYTES} bytes: ${userPath}`,
      false
    );
  }
  return fs.readFileSync(resolved, 'utf-8');
}

function indexByKindName(symbols: PactSymbol[]): Map<string, PactSymbol> {
  const m = new Map<string, PactSymbol>();
  for (const s of symbols) {
    m.set(`${s.kind}::${s.name}`, s);
  }
  return m;
}

function toDiffSymbol(s: PactSymbol): DiffSymbol {
  return {
    kind: s.kind,
    name: s.name,
    signature: sanitizeToolOutput(s.signature).text
  };
}

function normalizeSignature(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function sortSymbols(arr: DiffSymbol[]): DiffSymbol[] {
  return [...arr].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.name.localeCompare(b.name);
  });
}
