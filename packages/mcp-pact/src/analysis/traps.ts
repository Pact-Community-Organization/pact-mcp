/**
 * @fileoverview Pact 5 critical trap detection rules
 * @author Developer
 * @description Deterministic static analysis for the 5 critical Pact 5 traps.
 *              No parser; regex + balanced-paren scanning per rule.
 */

export type TrapSeverity = 'critical' | 'high' | 'medium';

export type TrapKind =
  | 'NON_BINARY_PLUS'
  | 'TRY_DML'
  | 'ENFORCE_DB_READ'
  | 'BUILTIN_SHADOW'
  | 'BARE_PACT_ID';

export interface DetectedTrap {
  kind: TrapKind;
  severity: TrapSeverity;
  line: number; // 1-based
  snippet: string;
  message: string;
  fix: string;
}

export interface TrapAnalysis {
  traps: DetectedTrap[];
  count: number;
  hasCritical: boolean;
}

export interface TrapCatalogEntry {
  kind: TrapKind;
  title: string;
  severity: TrapSeverity;
  description: string;
  pattern: string;
  fix: string;
  reference: string;
}

const TRAP_CATALOG: TrapCatalogEntry[] = [
  {
    kind: 'NON_BINARY_PLUS',
    title: 'Non-binary + operator',
    severity: 'critical',
    description: 'The + operator in Pact 5 is binary. Three or more args will fail at runtime.',
    pattern: '(+ a b c)',
    fix: 'Use (+ a (+ b c)) for more than two operands.',
    reference: 'https://kda-chain.org/docs'
  },
  {
    kind: 'TRY_DML',
    title: 'DML inside try block',
    severity: 'critical',
    description: 'try runs in read-only context; insert/write/update/create-table will fail.',
    pattern: '(try (write ...) ...)',
    fix: 'Move DML outside the try block, or use with-default-read for safe reads.',
    reference: 'https://kda-chain.org/docs'
  },
  {
    kind: 'ENFORCE_DB_READ',
    title: 'DB read inside enforce',
    severity: 'critical',
    description: 'enforce evaluates its boolean arg in read-only context on chainweb.',
    pattern: '(enforce (>= (read ...) ...))',
    fix: 'Bind the DB read to a let variable first, then enforce on the bound value.',
    reference: 'https://kda-chain.org/docs'
  },
  {
    kind: 'BUILTIN_SHADOW',
    title: 'Binding shadows built-in',
    severity: 'critical',
    description: 'Binding one of exp/abs/log/mod/round/ln/sqrt/floor/ceiling shadows the built-in.',
    pattern: '(let ((exp 2.7)) ...)',
    fix: 'Rename the binding (e.g. expVal, myExp).',
    reference: 'https://kda-chain.org/docs'
  },
  {
    kind: 'BARE_PACT_ID',
    title: 'Bare pact-id used as guard',
    severity: 'high',
    description: 'pact-id alone is not a sufficient access guard; compose with a capability.',
    pattern: '(enforce (= (pact-id) x))',
    fix: 'Wrap the check in a composed capability via with-capability / require-capability.',
    reference: 'https://kda-chain.org/docs'
  }
];

const BUILTIN_NAMES = [
  'exp',
  'abs',
  'log',
  'mod',
  'round',
  'ln',
  'sqrt',
  'floor',
  'ceiling'
];

const DML_OPS = ['insert', 'update', 'write', 'create-table'];

/**
 * [Developer] Analyze Pact source for the 5 critical Pact 5 traps.
 */
export function analyzeTraps(source: string): TrapAnalysis {
  const traps: DetectedTrap[] = [
    ...detectNonBinaryPlus(source),
    ...detectTryDml(source),
    ...detectEnforceDbRead(source),
    ...detectBuiltinShadow(source),
    ...detectBarePactId(source)
  ];

  traps.sort((a, b) =>
    a.line !== b.line ? a.line - b.line : a.kind.localeCompare(b.kind)
  );

  return {
    traps,
    count: traps.length,
    hasCritical: traps.some((t) => t.severity === 'critical')
  };
}

/** [Developer] Public accessor for the traps resource. */
export function getTrapsCatalog(): {
  version: string;
  traps: TrapCatalogEntry[];
} {
  return { version: '1.0.0', traps: TRAP_CATALOG };
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/**
 * [Developer] Non-binary +: find `(+ <arg1> <arg2> <arg3>...)` at the top of a
 * parenthesised form. We scan for `(+ ` and then tokenise the balanced form.
 */
function detectNonBinaryPlus(source: string): DetectedTrap[] {
  const findings: DetectedTrap[] = [];
  const regex = /\(\s*\+\s/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const formStart = match.index;
    const closeIdx = findMatchingClose(source, formStart);
    if (closeIdx === -1) continue;
    const inside = source.slice(formStart + match[0].length, closeIdx);
    const tokens = splitTopLevelTokens(inside);
    if (tokens.length > 2) {
      findings.push({
        kind: 'NON_BINARY_PLUS',
        severity: 'critical',
        line: lineOf(source, formStart),
        snippet: snippetOf(source, formStart, closeIdx),
        message: `'+' accepts exactly 2 arguments; found ${tokens.length}`,
        fix: 'Use (+ a (+ b c)) for more than two operands.'
      });
    }
  }
  return findings;
}

/**
 * [Developer] Try DML: find `(try ...)` forms, then search inside their body
 * for `(insert|update|write|create-table ...)` calls.
 */
function detectTryDml(source: string): DetectedTrap[] {
  const findings: DetectedTrap[] = [];
  const regex = /\(\s*try\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const formStart = match.index;
    const closeIdx = findMatchingClose(source, formStart);
    if (closeIdx === -1) continue;
    const inside = source.slice(formStart, closeIdx + 1);
    for (const op of DML_OPS) {
      const dmlRegex = new RegExp(`\\(\\s*${escapeRe(op)}\\b`, 'g');
      let dmlMatch: RegExpExecArray | null;
      while ((dmlMatch = dmlRegex.exec(inside)) !== null) {
        const absoluteIdx = formStart + dmlMatch.index;
        findings.push({
          kind: 'TRY_DML',
          severity: 'critical',
          line: lineOf(source, absoluteIdx),
          snippet: snippetLine(source, absoluteIdx),
          message: `DML operation '${op}' is not allowed inside (try ...) — try is read-only`,
          fix: 'Move DML outside try, or use with-default-read for safe reads.'
        });
      }
    }
  }
  return findings;
}

/**
 * [Developer] Enforce DB read: find `(enforce <cond>)` and inspect <cond> for
 * read/with-read/select/keys invocations. `with-default-read` is EXCLUDED
 * because it is itself a read-only form.
 */
function detectEnforceDbRead(source: string): DetectedTrap[] {
  const findings: DetectedTrap[] = [];
  const regex = /\(\s*enforce\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const formStart = match.index;
    const closeIdx = findMatchingClose(source, formStart);
    if (closeIdx === -1) continue;
    const inside = source.slice(formStart + match[0].length, closeIdx);
    const condTokens = splitTopLevelTokens(inside);
    const cond = condTokens[0] ?? '';
    const dbPattern =
      /\(\s*(read|with-read|select|keys)\b(?!-)/;
    const m = cond.match(dbPattern);
    if (m && m[1]) {
      findings.push({
        kind: 'ENFORCE_DB_READ',
        severity: 'critical',
        line: lineOf(source, formStart),
        snippet: snippetOf(source, formStart, closeIdx),
        message: `DB read '${m[1]}' inside (enforce ...) is read-only and will fail on chainweb`,
        fix: 'Bind the DB read to a let-variable first, then enforce on the bound value.'
      });
    }
  }
  return findings;
}

/**
 * [Developer] Built-in shadowing: any `let` / `let*` binding, `defun` param,
 * or `bind` whose name is one of the Pact built-ins.
 */
function detectBuiltinShadow(source: string): DetectedTrap[] {
  const findings: DetectedTrap[] = [];
  const nameAlt = BUILTIN_NAMES.join('|');

  // let / let* bindings: `((name value) ...)`
  const letBinding = new RegExp(
    `\\(\\s*let\\*?\\s*\\(\\s*\\(\\s*(${nameAlt})\\b`,
    'g'
  );
  // defun params: `(defun foo:type (name:type ...)`
  const defunParam = new RegExp(
    `\\(\\s*defun\\b[^()]*\\(\\s*(${nameAlt})[:\\s)]`,
    'g'
  );
  // bind object form: `(bind obj { "k" := name, ...`
  const bindName = new RegExp(`:=\\s*(${nameAlt})\\b`, 'g');

  for (const re of [letBinding, defunParam, bindName]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const idx = m.index;
      const name = m[1]!;
      findings.push({
        kind: 'BUILTIN_SHADOW',
        severity: 'critical',
        line: lineOf(source, idx),
        snippet: snippetLine(source, idx),
        message: `Binding '${name}' shadows built-in function`,
        fix: `Rename the binding (e.g. ${name}Val, my${capitalize(name)}).`
      });
    }
  }
  return findings;
}

/**
 * [Developer] Bare pact-id guard: `(enforce (= (pact-id) ...))` not composed
 * with a capability. Heuristic: flag every occurrence; recommend wrapping in
 * a composed capability.
 */
function detectBarePactId(source: string): DetectedTrap[] {
  const findings: DetectedTrap[] = [];
  const regex =
    /\(\s*enforce\s+\(\s*=\s+\(\s*pact-id\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(source)) !== null) {
    const idx = m.index;
    findings.push({
      kind: 'BARE_PACT_ID',
      severity: 'high',
      line: lineOf(source, idx),
      snippet: snippetLine(source, idx),
      message: 'pact-id is insufficient as a sole access guard',
      fix:
        'Compose with a capability: (require-capability (MY-CAP ...)) or wrap with (with-capability ...).'
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function findMatchingClose(source: string, openIdx: number): number {
  let depth = 0;
  let inString = false;
  let inLineComment = false;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i]!;
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === ';') {
      inLineComment = true;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * [Developer] Split a parenthesised form body into top-level tokens. Strings,
 * line comments and nested forms are treated as single tokens.
 */
function splitTopLevelTokens(body: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = '';
  let inString = false;
  let inLineComment = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inString) {
      current += ch;
      if (ch === '\\' && i + 1 < body.length) {
        current += body[i + 1];
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === ';') {
      inLineComment = true;
      continue;
    }
    if (ch === '"') {
      inString = true;
      current += ch;
      continue;
    }
    if (ch === '(') {
      depth++;
      current += ch;
      continue;
    }
    if (ch === ')') {
      depth--;
      current += ch;
      continue;
    }
    if (depth === 0 && /\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

function snippetOf(source: string, start: number, end: number): string {
  const raw = source.slice(start, end + 1).trim();
  return raw.length > 200 ? raw.slice(0, 200) + '…' : raw;
}

function snippetLine(source: string, index: number): string {
  const lineStart = source.lastIndexOf('\n', index - 1) + 1;
  let lineEnd = source.indexOf('\n', index);
  if (lineEnd === -1) lineEnd = source.length;
  return source.slice(lineStart, lineEnd).trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
