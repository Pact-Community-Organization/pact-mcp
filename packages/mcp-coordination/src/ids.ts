/**
 * @fileoverview 26-char Crockford base32 ULIDs with prefix tags.
 *
 * Monotonic within the same millisecond at the single-process level.
 */

import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let lastTimeMs = 0;
let lastRandom: number[] = new Array<number>(16).fill(0);

function bumpRandom(): void {
  for (let i = lastRandom.length - 1; i >= 0; i -= 1) {
    const next = (lastRandom[i] ?? 0) + 1;
    if (next < 32) {
      lastRandom[i] = next;
      return;
    }
    lastRandom[i] = 0;
  }
  // Overflow: reseed.
  lastRandom = freshRandom();
}

function freshRandom(): number[] {
  const bytes = randomBytes(10);
  const result: number[] = new Array<number>(16).fill(0);
  let bits = 0;
  let acc = 0;
  let idx = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5 && idx < 16) {
      bits -= 5;
      result[idx] = (acc >> bits) & 0x1f;
      idx += 1;
    }
  }
  return result;
}

function encodeTime(ms: number): string {
  let t = ms;
  const out: string[] = new Array<string>(10).fill('0');
  for (let i = 9; i >= 0; i -= 1) {
    const rem = t % 32;
    out[i] = CROCKFORD[rem]!;
    t = Math.floor(t / 32);
  }
  return out.join('');
}

function encodeRandom(parts: number[]): string {
  return parts.map((v) => CROCKFORD[v] ?? '0').join('');
}

function nextUlid(): string {
  const now = Date.now();
  if (now > lastTimeMs) {
    lastTimeMs = now;
    lastRandom = freshRandom();
  } else {
    bumpRandom();
  }
  return encodeTime(lastTimeMs) + encodeRandom(lastRandom);
}

export function generateTaskId(): string {
  return `T_${nextUlid()}`;
}

export function generateMessageId(): string {
  return `M_${nextUlid()}`;
}

export const TASK_ID_REGEX = /^T_[0-9A-HJKMNP-TV-Z]{26}$/;
export const MESSAGE_ID_REGEX = /^M_[0-9A-HJKMNP-TV-Z]{26}$/;
