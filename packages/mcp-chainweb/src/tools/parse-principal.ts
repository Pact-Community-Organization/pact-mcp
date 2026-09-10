/**
 * @fileoverview chainweb_parse_principal - Parse, classify, and validate Kadena principals (Ed25519, WebAuthn, and Post-Quantum SLH-DSA).
 */

import { z } from 'zod';
import { McpToolError } from '@pact-community/mcp-shared';

export const ParsePrincipalInputShape = {
  principal: z
    .string()
    .min(1)
    .max(256)
    .describe('The Kadena principal string to parse and validate (e.g., k:..., q:..., x:..., w:..., n_...).')
};

export const ParsePrincipalInputSchema = z.object(ParsePrincipalInputShape);

export interface ParsePrincipalResult {
  principal: string;
  scheme: 'k-ed25519' | 'w-webauthn' | 'q-slhdsa-pq' | 'x-slhdsa-multisig' | 'r-keyset-ref' | 'c-capability' | 'u-user-guard' | 'n-namespace' | 'custom-account';
  isValid: boolean;
  isPostQuantum: boolean;
  keyLengthBytes?: number | undefined;
  details: {
    prefix?: string | undefined;
    rawIdentifier: string;
    description: string;
  };
  pact5Compatibility: {
    supported: boolean;
    recommendedGuardType: string;
    gasVerificationModel: string;
  };
}

const HEX_64 = /^[0-9a-fA-F]{64}$/;
const HEX_96 = /^[0-9a-fA-F]{96}$/;
const HEX_128 = /^[0-9a-fA-F]{128}$/;
const NS_REGEX = /^n_[a-f0-9]{40}$/;

export function createParsePrincipalTool() {
  return async function parsePrincipal(
    args: unknown
  ): Promise<{ content: ParsePrincipalResult[] }> {
    const input = ParsePrincipalInputSchema.parse(args);
    const p = input.principal.trim();

    let scheme: ParsePrincipalResult['scheme'] = 'custom-account';
    let isValid = true;
    let isPostQuantum = false;
    let keyLengthBytes: number | undefined;
    let prefix: string | undefined;
    let rawIdentifier = p;
    let description = 'Custom account identifier (unprefixed or contract-managed).';
    let supported = true;
    let recommendedGuardType = 'custom';
    let gasVerificationModel = 'standard';

    if (p.startsWith('k:')) {
      prefix = 'k:';
      rawIdentifier = p.slice(2);
      scheme = 'k-ed25519';
      isValid = HEX_64.test(rawIdentifier);
      keyLengthBytes = 32;
      description = 'Standard Ed25519 single-key keyset account.';
      recommendedGuardType = '(read-keyset "ks") single-key';
      gasVerificationModel = 'post33GasModel (100 gas/sig)';
    } else if (p.startsWith('q:')) {
      prefix = 'q:';
      rawIdentifier = p.slice(2);
      scheme = 'q-slhdsa-pq';
      isPostQuantum = true;
      if (HEX_64.test(rawIdentifier)) keyLengthBytes = 32;
      else if (HEX_96.test(rawIdentifier)) keyLengthBytes = 48;
      else if (HEX_128.test(rawIdentifier)) keyLengthBytes = 64;
      else keyLengthBytes = Math.floor(rawIdentifier.length / 2);

      isValid = /^[0-9a-fA-F]+$/.test(rawIdentifier) && rawIdentifier.length >= 64;
      description = 'NIST FIPS 205 SLH-DSA Post-Quantum single-key account (KIP-0041).';
      recommendedGuardType = '(read-keyset "pq-ks") SLH-DSA';
      gasVerificationModel = 'post33GasModel (816 - 3992 gas/sig)';
    } else if (p.startsWith('x:')) {
      prefix = 'x:';
      rawIdentifier = p.slice(2);
      scheme = 'x-slhdsa-multisig';
      isPostQuantum = true;
      isValid = /^[0-9a-fA-F]{40,128}$/.test(rawIdentifier);
      description = 'Post-Quantum threshold multi-sig keyset hash principal.';
      recommendedGuardType = 'keyset-ref / multi-sig keyset guard';
      gasVerificationModel = 'post33GasModel (cumulative PQ sigs)';
    } else if (p.startsWith('w:')) {
      prefix = 'w:';
      rawIdentifier = p.slice(2);
      scheme = 'w-webauthn';
      isValid = rawIdentifier.length >= 10;
      description = 'WebAuthn / Passkey hardware credential principal.';
      recommendedGuardType = 'WebAuthn hardware guard';
      gasVerificationModel = 'post33GasModel (150 gas/sig)';
    } else if (p.startsWith('r:')) {
      prefix = 'r:';
      rawIdentifier = p.slice(2);
      scheme = 'r-keyset-ref';
      isValid = rawIdentifier.length > 0;
      description = 'Keyset reference name principal.';
      recommendedGuardType = 'keyset-ref-guard';
      gasVerificationModel = 'lookup-only (minimal gas)';
    } else if (p.startsWith('c:')) {
      prefix = 'c:';
      rawIdentifier = p.slice(2);
      scheme = 'c-capability';
      isValid = rawIdentifier.length >= 20;
      description = 'Autonomous module capability guard principal.';
      recommendedGuardType = 'create-capability-guard';
      gasVerificationModel = 'in-memory capability check';
    } else if (p.startsWith('u:')) {
      prefix = 'u:';
      rawIdentifier = p.slice(2);
      scheme = 'u-user-guard';
      isValid = rawIdentifier.length >= 20;
      description = 'Custom user guard predicate principal.';
      recommendedGuardType = 'create-user-guard';
      gasVerificationModel = 'predicate execution gas';
    } else if (p.startsWith('n_')) {
      scheme = 'n-namespace';
      isValid = NS_REGEX.test(p);
      description = 'Deterministic principal namespace identifier.';
      recommendedGuardType = 'define-namespace principal guard';
      gasVerificationModel = 'namespace resolution';
    }

    return {
      content: [
        {
          principal: p,
          scheme,
          isValid,
          isPostQuantum,
          keyLengthBytes,
          details: {
            prefix,
            rawIdentifier,
            description
          },
          pact5Compatibility: {
            supported,
            recommendedGuardType,
            gasVerificationModel
          }
        }
      ]
    };
  };
}
