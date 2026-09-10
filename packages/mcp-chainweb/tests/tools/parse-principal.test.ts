import { describe, it, expect } from 'vitest';
import { createParsePrincipalTool } from '../../src/tools/parse-principal.js';

describe('chainweb_parse_principal', () => {
  const tool = createParsePrincipalTool();

  it('correctly classifies Ed25519 k: principal', async () => {
    const pub = 'a'.repeat(64);
    const res = await tool({ principal: `k:${pub}` });
    const p = res.content[0]!;
    expect(p.scheme).toBe('k-ed25519');
    expect(p.isValid).toBe(true);
    expect(p.isPostQuantum).toBe(false);
    expect(p.keyLengthBytes).toBe(32);
  });

  it('correctly classifies Post-Quantum SLH-DSA q: principal', async () => {
    const pub = 'b'.repeat(64); // 32-byte SLH-DSA-128s pubkey
    const res = await tool({ principal: `q:${pub}` });
    const p = res.content[0]!;
    expect(p.scheme).toBe('q-slhdsa-pq');
    expect(p.isValid).toBe(true);
    expect(p.isPostQuantum).toBe(true);
    expect(p.keyLengthBytes).toBe(32);
    expect(p.pact5Compatibility.supported).toBe(true);
  });

  it('correctly classifies Post-Quantum Multi-Sig x: principal', async () => {
    const hash = 'c'.repeat(40);
    const res = await tool({ principal: `x:${hash}` });
    const p = res.content[0]!;
    expect(p.scheme).toBe('x-slhdsa-multisig');
    expect(p.isValid).toBe(true);
    expect(p.isPostQuantum).toBe(true);
  });

  it('correctly classifies WebAuthn w: principal', async () => {
    const res = await tool({ principal: 'w:credential-id-12345:webauthn' });
    const p = res.content[0]!;
    expect(p.scheme).toBe('w-webauthn');
    expect(p.isValid).toBe(true);
    expect(p.isPostQuantum).toBe(false);
  });

  it('correctly classifies Principal Namespace n_...', async () => {
    const hash = 'd'.repeat(40);
    const res = await tool({ principal: `n_${hash}` });
    const p = res.content[0]!;
    expect(p.scheme).toBe('n-namespace');
    expect(p.isValid).toBe(true);
  });
});
