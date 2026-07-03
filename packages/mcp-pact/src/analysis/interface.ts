/**
 * @fileoverview Lightweight public-API extractor for .pact modules
 * @description Extracts top-level symbols (module, implements, defun, defcap,
 *              defpact, defschema, deftable) from a .pact source string using
 *              balanced-paren scanning. Not a full parser; handles the 95%
 *              case. Known limitations documented in README.
 */

export type SymbolKind =
  | 'module'
  | 'implements'
  | 'defun'
  | 'defcap'
  | 'defpact'
  | 'defschema'
  | 'deftable';

export interface PactSymbol {
  kind: SymbolKind;
  name: string;
  /** Source-span of the declaration (first non-empty line of the form, trimmed). */
  signature: string;
  /** 1-based line number where the form begins. */
  line: number;
}

export interface InterfaceExtraction {
  moduleName: string | null;
  symbols: PactSymbol[];
  parseWarnings: string[];
}

const KINDS_INSIDE_MODULE = new Set<SymbolKind>([
  'implements',
  'defun',
  'defcap',
  'defpact',
  'defschema',
  'deftable'
]);

/**
 * Extract the public API surface of a .pact module.
 *
 * Approach:
 *  - Strip line comments (`;...` to end-of-line) and string literals so
 *    parentheses inside them don't confuse the depth counter.
 *  - Walk character-by-character tracking paren depth.
 *  - When we see `(` at depth 0 → top-level form; at depth 1 inside a module
 *    → in-module declaration.
 *  - Read the head keyword. If it's one we care about, read the name (next
 *    token) and capture the signature span (from `(` to the end of that same
 *    logical line, truncated).
 */
export function extractInterface(source: string): InterfaceExtraction {
  const warnings: string[] = [];
  const symbols: PactSymbol[] = [];
  let moduleName: string | null = null;

  // Build a parallel "scrubbed" string: comments and string
  // literals replaced with spaces so paren depth tracking isn't fooled.
  const scrubbed = scrub(source);

  let depth = 0;
  let moduleDepth: number | null = null; // depth where we entered module body
  const len = scrubbed.length;

  for (let i = 0; i < len; i++) {
    const ch = scrubbed[i];
    if (ch === '(') {
      // Peek the next non-whitespace token.
      const headStart = i + 1;
      let j = headStart;
      while (j < len && /\s/.test(scrubbed[j]!)) j++;
      const tokenStart = j;
      while (j < len && !/[\s()]/.test(scrubbed[j]!)) j++;
      const head = scrubbed.slice(tokenStart, j);

      const lineNumber = lineOf(source, i);

      // Read the next token = name (if any).
      let k = j;
      while (k < len && /\s/.test(scrubbed[k]!)) k++;
      const nameStart = k;
      while (k < len && !/[\s()]/.test(scrubbed[k]!)) k++;
      const rawName = source.slice(nameStart, k);
      // Strip Pact return-type annotation `name:type` so that
      // `(defun foo:string ...)` indexes as `foo`, not `foo:string`.
      const colonIdx = rawName.indexOf(':');
      const name = colonIdx >= 0 ? rawName.slice(0, colonIdx) : rawName;

      if (depth === 0 && head === 'module') {
        moduleName = name || null;
        moduleDepth = depth + 1;
        symbols.push({
          kind: 'module',
          name: name || '<anonymous>',
          signature: extractSignature(source, i, scrubbed),
          line: lineNumber
        });
      } else if (
        moduleDepth !== null &&
        depth === moduleDepth &&
        KINDS_INSIDE_MODULE.has(head as SymbolKind)
      ) {
        const kind = head as SymbolKind;
        if (!name) {
          warnings.push(
            `line ${lineNumber}: ${kind} form missing name token; skipped`
          );
        } else {
          symbols.push({
            kind,
            name,
            signature: extractSignature(source, i, scrubbed),
            line: lineNumber
          });
        }
      }

      depth++;
    } else if (ch === ')') {
      depth--;
      if (moduleDepth !== null && depth < moduleDepth) {
        // left the module body
        moduleDepth = null;
      }
    }
  }

  if (depth !== 0) {
    warnings.push(
      `unbalanced parentheses (final depth ${depth}); extraction may be incomplete`
    );
  }

  return { moduleName, symbols, parseWarnings: warnings };
}

/**
 * Extract a readable signature span from the open paren.
 * Walks balanced parens (using the scrubbed source so comments/strings don't
 * confuse depth tracking) and returns the full form with newlines collapsed
 * to single spaces. Capped at 240 characters.
 */
function extractSignature(source: string, openIdx: number, scrubbed: string): string {
  const MAX = 240;
  let depth = 0;
  let end = openIdx;
  for (let i = openIdx; i < source.length; i++) {
    const c = scrubbed[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
    end = i + 1;
  }
  const raw = source.slice(openIdx, end).replace(/\s+/g, ' ').trim();
  return raw.length > MAX ? raw.slice(0, MAX) + '…' : raw;
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

/**
 * Replace comments and string literals with spaces of the same
 * length so offsets still line up with the original source. Paren characters
 * inside comments/strings are neutralized.
 */
function scrub(source: string): string {
  const out = source.split('');
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (ch === ';') {
      // line comment → replace until newline
      while (i < n && source[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
    } else if (ch === '"') {
      out[i] = ' ';
      i++;
      while (i < n) {
        const c = source[i];
        if (c === '\\' && i + 1 < n) {
          out[i] = ' ';
          out[i + 1] = source[i + 1] === '\n' ? '\n' : ' ';
          i += 2;
          continue;
        }
        if (c === '"') {
          out[i] = ' ';
          i++;
          break;
        }
        out[i] = c === '\n' ? '\n' : ' ';
        i++;
      }
    } else {
      i++;
    }
  }
  return out.join('');
}
