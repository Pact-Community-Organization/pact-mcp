/**
 * @fileoverview Unit tests for pact.interface_diff tool + parser
 */

import { describe, test, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createInterfaceDiffTool } from '../../src/tools/interface-diff.js';
import { extractInterface } from '../../src/analysis/interface.js';

const fixtures = path.resolve(import.meta.dirname, '../fixtures');
const diff = createInterfaceDiffTool({ workspaceRoot: fixtures });

describe('pact.interface_diff', () => {
  test('identical modules produce only unchanged symbols', async () => {
    const r = await diff({
      before: 'iface-identical-a.pact',
      after: 'iface-identical-b.pact'
    });
    const p = r.content[0]!;
    expect(p.breakingChange).toBe(false);
    expect(p.added).toEqual([]);
    expect(p.removed).toEqual([]);
    expect(p.changed).toEqual([]);
    expect(p.unchanged.length).toBeGreaterThan(0);
    expect(p.unchanged.some((s) => s.name === 'foo')).toBe(true);
  });

  test('detects added, removed and changed symbols', async () => {
    const r = await diff({
      before: 'iface-before.pact',
      after: 'iface-after.pact'
    });
    const p = r.content[0]!;
    expect(p.moduleName.before).toBe('iface-before');
    expect(p.moduleName.after).toBe('iface-after');

    // added: burn (defun)
    expect(p.added.some((s) => s.kind === 'defun' && s.name === 'burn')).toBe(true);

    // removed: cross-transfer (defpact)
    expect(
      p.removed.some((s) => s.kind === 'defpact' && s.name === 'cross-transfer')
    ).toBe(true);

    // changed: transfer (extra param)
    const chTransfer = p.changed.find((c) => c.name === 'transfer');
    expect(chTransfer).toBeDefined();
    expect(chTransfer!.kind).toBe('defun');
    expect(chTransfer!.before.signature).not.toEqual(chTransfer!.after.signature);

    // changed: account (schema field added)
    const chSchema = p.changed.find((c) => c.name === 'account');
    expect(chSchema).toBeDefined();
    expect(chSchema!.kind).toBe('defschema');

    // module rename also counts as changed at the module symbol
    const chModule = p.changed.find((c) => c.kind === 'module');
    // before/after have different module names so they split into added+removed
    // (not "changed") because the diff key is kind+name
    expect(chModule).toBeUndefined();
    expect(p.added.some((s) => s.kind === 'module' && s.name === 'iface-after')).toBe(
      true
    );
    expect(
      p.removed.some((s) => s.kind === 'module' && s.name === 'iface-before')
    ).toBe(true);

    expect(p.breakingChange).toBe(true);
  });

  test('rejects non-.pact extensions', async () => {
    await expect(
      diff({ before: 'notes.txt', after: 'iface-after.pact' })
    ).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE' });
  });

  test('rejects missing files', async () => {
    await expect(
      diff({ before: 'nope.pact', after: 'iface-after.pact' })
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  });

  test('throws UNPARSEABLE_PACT when both files have no extractable symbols', async () => {
    const emptyA = path.join(fixtures, 'empty-a.pact');
    const emptyB = path.join(fixtures, 'empty-b.pact');
    fs.writeFileSync(emptyA, '; just a comment\n');
    fs.writeFileSync(emptyB, '; just a comment\n');
    try {
      await expect(
        diff({ before: 'empty-a.pact', after: 'empty-b.pact' })
      ).rejects.toMatchObject({ code: 'UNPARSEABLE_PACT' });
    } finally {
      fs.unlinkSync(emptyA);
      fs.unlinkSync(emptyB);
    }
  });

  test('parseWarnings are exposed when input has unbalanced parens', async () => {
    const bad = path.join(fixtures, 'bad-parens.pact');
    fs.writeFileSync(bad, '(module broken GOV\n(defun foo () "x")');
    try {
      const r = await diff({ before: 'bad-parens.pact', after: 'iface-after.pact' });
      const p = r.content[0]!;
      expect(p.parseWarnings.some((w) => /unbalanced/i.test(w))).toBe(true);
    } finally {
      fs.unlinkSync(bad);
    }
  });
});

describe('extractInterface (analysis)', () => {
  test('extracts all symbol kinds from before fixture', () => {
    const src = fs.readFileSync(path.join(fixtures, 'iface-before.pact'), 'utf-8');
    const ex = extractInterface(src);
    const kinds = new Set(ex.symbols.map((s) => s.kind));
    expect(kinds.has('module')).toBe(true);
    expect(kinds.has('implements')).toBe(true);
    expect(kinds.has('defcap')).toBe(true);
    expect(kinds.has('defun')).toBe(true);
    expect(kinds.has('defpact')).toBe(true);
    expect(kinds.has('defschema')).toBe(true);
    expect(kinds.has('deftable')).toBe(true);
  });

  test('ignores parens inside line comments', () => {
    const src = `
(module x GOV
  ; (defun invisible () "not real")
  (defun real () "yes")
)`;
    const ex = extractInterface(src);
    expect(ex.symbols.some((s) => s.name === 'real')).toBe(true);
    expect(ex.symbols.some((s) => s.name === 'invisible')).toBe(false);
  });

  test('ignores parens inside string literals', () => {
    const src = `
(module x GOV
  (defun f () "this has (fake) parens")
)`;
    const ex = extractInterface(src);
    const f = ex.symbols.find((s) => s.name === 'f');
    expect(f).toBeDefined();
    expect(ex.moduleName).toBe('x');
  });

  test('reports moduleName=null when no module present', () => {
    const ex = extractInterface('; no module\n');
    expect(ex.moduleName).toBeNull();
    expect(ex.symbols).toHaveLength(0);
  });
});
