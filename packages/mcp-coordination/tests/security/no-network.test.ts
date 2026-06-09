import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, acc);
    } else if (full.endsWith('.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('no outbound network primitives in src/', () => {
  it('grep of network APIs returns zero matches in src/', () => {
    const here = path.resolve(__dirname, '..', '..', 'src');
    const files = walk(here);
    const forbidden = /\b(fetch\s*\(|require\(['"]http['"]\)|require\(['"]https['"]\)|require\(['"]net['"]\)|from ['"]node:http['"]|from ['"]node:https['"]|from ['"]node:net['"]|undici)\b/;
    const hits: string[] = [];
    for (const f of files) {
      const body = readFileSync(f, 'utf8');
      if (forbidden.test(body)) hits.push(path.relative(here, f));
    }
    expect(hits).toEqual([]);
  });

  it('dist/bin.js and dist/server.js also carry no network APIs', () => {
    const distDir = path.resolve(__dirname, '..', '..', 'dist');
    for (const name of ['bin.js', 'server.js']) {
      const full = path.join(distDir, name);
      const body = readFileSync(full, 'utf8');
      expect(body).not.toMatch(/\bfetch\s*\(/);
      expect(body).not.toMatch(/\b(undici)\b/);
      expect(body).not.toMatch(/from ['"]node:http['"]/);
      expect(body).not.toMatch(/from ['"]node:https['"]/);
      expect(body).not.toMatch(/from ['"]node:net['"]/);
    }
  });
});
