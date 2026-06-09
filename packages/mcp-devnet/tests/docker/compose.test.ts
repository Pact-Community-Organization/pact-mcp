/**
 * @fileoverview Unit tests — src/docker/compose.ts
 * @author Developer
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';

import { AGENT_MAP } from '../../src/agents.js';
import {
  resolveComposeFile,
  validateComposeFileContent,
  parseComposePs
} from '../../src/docker/compose.js';
import { McpToolError } from '@pact-community/mcp-shared';
import {
  createTempWorkspace,
  cleanupTempWorkspace,
  VALID_COMPOSE_CONTENT,
  SUSPICIOUS_COMPOSE_CONTENT
} from '../fixtures/fake-docker.js';

const workspaces: string[] = [];
function ws(files?: Record<string, string>): string {
  const dir = createTempWorkspace(files);
  workspaces.push(dir);
  return dir;
}

afterEach(() => {
  while (workspaces.length > 0) {
    const w = workspaces.pop();
    if (w) cleanupTempWorkspace(w);
  }
});

describe('resolveComposeFile', () => {
  it('returns state:missing when the file does not exist', () => {
    const root = ws();
    const r = resolveComposeFile(root, AGENT_MAP.Developer);
    expect(r.state).toBe('missing');
    expect(r.absolutePath).toBeUndefined();
    expect(r.attemptedPath.endsWith('docker-compose.forge.yml')).toBe(true);
  });

  it('returns state:present with canonical path when present', () => {
    const root = ws({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
    });
    const r = resolveComposeFile(root, AGENT_MAP.Developer);
    expect(r.state).toBe('present');
    expect(r.absolutePath).toBeDefined();
    expect(r.workDir).toBe(path.dirname(r.absolutePath!));
  });

  it('rejects symlink escape out of the workspace', () => {
    // Create an outside file, then a symlink inside the workspace that
    // points at it. resolveInsideWorkspace should throw.
    const outsideDir = fs.mkdtempSync(
      path.join(require('node:os').tmpdir(), 'outside-')
    );
    const outsideFile = path.join(outsideDir, 'evil.yml');
    fs.writeFileSync(outsideFile, VALID_COMPOSE_CONTENT);
    const root = ws();
    fs.symlinkSync(
      outsideFile,
      path.join(root, 'dao', 'docker-compose.forge.yml')
    );
    try {
      expect(() => resolveComposeFile(root, AGENT_MAP.Developer)).toThrow();
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe('validateComposeFileContent', () => {
  it('accepts a valid compose file with whitelisted container names', () => {
    const root = ws({
      'pact-examples/docker-compose.forge.yml': VALID_COMPOSE_CONTENT
    });
    const r = resolveComposeFile(root, AGENT_MAP.Developer);
    expect(() =>
      validateComposeFileContent(r.absolutePath!, AGENT_MAP.Developer)
    ).not.toThrow();
  });

  it('rejects a compose file without top-level services: key', () => {
    const root = ws({
      'pact-examples/docker-compose.forge.yml': 'version: "3"\nvolumes:\n  foo:\n'
    });
    const r = resolveComposeFile(root, AGENT_MAP.Developer);
    expect(() =>
      validateComposeFileContent(r.absolutePath!, AGENT_MAP.Developer)
    ).toThrow(McpToolError);
  });

  it('rejects a compose file with a non-allowlisted container_name', () => {
    const root = ws({
      'pact-examples/docker-compose.forge.yml': SUSPICIOUS_COMPOSE_CONTENT
    });
    const r = resolveComposeFile(root, AGENT_MAP.Developer);
    try {
      validateComposeFileContent(r.absolutePath!, AGENT_MAP.Developer);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(McpToolError);
      expect((e as McpToolError).code).toBe('COMPOSE_FILE_SUSPICIOUS');
    }
  });
});

describe('parseComposePs', () => {
  it('returns overall:down on empty output', () => {
    expect(parseComposePs('').overall).toBe('down');
  });

  it('parses NDJSON output with one running service', () => {
    const ndjson = JSON.stringify({
      Name: 'devnet-forge-boot',
      Service: 'bootstrap-node',
      State: 'running',
      Status: 'Up 3 minutes (healthy)',
      Health: 'healthy',
      Publishers: [
        { URL: '0.0.0.0', TargetPort: 8081, PublishedPort: 8081, Protocol: 'tcp' }
      ]
    });
    const parsed = parseComposePs(ndjson);
    expect(parsed.overall).toBe('up');
    expect(parsed.services).toHaveLength(1);
    expect(parsed.services[0]!.state).toBe('running');
    expect(parsed.services[0]!.health).toBe('healthy');
    expect(parsed.services[0]!.ports[0]).toContain('8081');
  });

  it('parses a JSON array with mixed states → partial', () => {
    const arr = JSON.stringify([
      { Service: 'a', State: 'running', Status: '...' },
      { Service: 'b', State: 'exited', Status: '...' }
    ]);
    const parsed = parseComposePs(arr);
    expect(parsed.overall).toBe('partial');
  });

  it('reports overall:down when all services are not running', () => {
    const ndjson = [
      JSON.stringify({ Service: 'a', State: 'exited', Status: '' }),
      JSON.stringify({ Service: 'b', State: 'exited', Status: '' })
    ].join('\n');
    expect(parseComposePs(ndjson).overall).toBe('down');
  });

  it('falls back to Ports string when Publishers is absent', () => {
    const ndjson = JSON.stringify({
      Service: 'a',
      State: 'running',
      Status: '',
      Ports: '0.0.0.0:8081->8081/tcp, 0.0.0.0:9999->9999/tcp'
    });
    const parsed = parseComposePs(ndjson);
    expect(parsed.services[0]!.ports).toHaveLength(2);
  });

  it('normalizes unknown State strings to "unknown"', () => {
    const ndjson = JSON.stringify({ Service: 'x', State: 'zombie', Status: '' });
    expect(parseComposePs(ndjson).services[0]!.state).toBe('unknown');
  });

  it('silently skips unparseable NDJSON lines', () => {
    const mix = `{"Service":"a","State":"running","Status":""}
this is not json
{"Service":"b","State":"running","Status":""}`;
    const parsed = parseComposePs(mix);
    expect(parsed.services).toHaveLength(2);
    expect(parsed.overall).toBe('up');
  });
});
