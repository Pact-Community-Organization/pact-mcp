/**
 * @fileoverview Tests for shared Zod schemas
 */

import { describe, it, expect } from 'vitest';
import {
  ChainId,
  NetworkId,
  AccountName,
  PactDecimal,
  PublicKey,
  AgentId,
  TxHash,
  BlockHash,
  CapabilityName,
  ModuleName,
  KeysetName,
  GasLimit,
  GasPrice,
  TTL,
  CreationTime
} from '../src/schemas/index.js';

describe('schemas', () => {
  describe('ChainId', () => {
    it('should accept valid chain IDs (0-19)', () => {
      expect(ChainId.parse(0)).toBe(0);
      expect(ChainId.parse(10)).toBe(10);
      expect(ChainId.parse(19)).toBe(19);
    });

    it('should reject invalid chain IDs', () => {
      expect(() => ChainId.parse(-1)).toThrow();
      expect(() => ChainId.parse(20)).toThrow();
      expect(() => ChainId.parse(1.5)).toThrow();
      expect(() => ChainId.parse('5')).toThrow();
    });
  });

  describe('NetworkId', () => {
    it('should accept valid network IDs', () => {
      expect(NetworkId.parse('development')).toBe('development');
      expect(NetworkId.parse('testnet06')).toBe('testnet06');
      expect(NetworkId.parse('mainnet01')).toBe('mainnet01');
    });

    it('should reject invalid network IDs', () => {
      expect(() => NetworkId.parse('testnet04')).toThrow();
      expect(() => NetworkId.parse('mainnet')).toThrow();
      expect(() => NetworkId.parse('devnet')).toThrow();
      expect(() => NetworkId.parse('')).toThrow();
    });
  });

  describe('AccountName', () => {
    it('should accept valid account names', () => {
      expect(AccountName.parse('alice')).toBe('alice');
      expect(AccountName.parse('k:368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43cca')).toBe('k:368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43cca');
      expect(AccountName.parse('dao-treasury')).toBe('dao-treasury');
      expect(AccountName.parse('test_account')).toBe('test_account');
      expect(AccountName.parse('account.v1')).toBe('account.v1');
    });

    it('should reject invalid account names', () => {
      expect(() => AccountName.parse('ab')).toThrow(); // Too short
      expect(() => AccountName.parse('a'.repeat(257))).toThrow(); // Too long
      expect(() => AccountName.parse('alice@bob')).toThrow(); // Invalid character
      expect(() => AccountName.parse('alice bob')).toThrow(); // Space
      expect(() => AccountName.parse('alice/bob')).toThrow(); // Slash
      expect(() => AccountName.parse('')).toThrow(); // Empty
    });
  });

  describe('PactDecimal', () => {
    it('should accept valid decimal strings', () => {
      expect(PactDecimal.parse('123')).toBe('123');
      expect(PactDecimal.parse('123.456')).toBe('123.456');
      expect(PactDecimal.parse('-123.456')).toBe('-123.456');
      expect(PactDecimal.parse('0')).toBe('0');
      expect(PactDecimal.parse('0.0')).toBe('0.0');
    });

    it('should reject invalid decimal strings', () => {
      expect(() => PactDecimal.parse('123.')).toThrow(); // Trailing dot
      expect(() => PactDecimal.parse('.123')).toThrow(); // Leading dot
      expect(() => PactDecimal.parse('12.34.56')).toThrow(); // Multiple dots
      expect(() => PactDecimal.parse('abc')).toThrow(); // Non-numeric
      expect(() => PactDecimal.parse('12.34e5')).toThrow(); // Scientific notation
      expect(() => PactDecimal.parse('')).toThrow(); // Empty
    });
  });

  describe('PublicKey', () => {
    it('should accept valid public keys', () => {
      const validKey = '368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43cca';
      expect(PublicKey.parse(validKey)).toBe(validKey);
      expect(PublicKey.parse(validKey.toUpperCase())).toBe(validKey.toUpperCase());
    });

    it('should reject invalid public keys', () => {
      expect(() => PublicKey.parse('invalid')).toThrow(); // Too short
      expect(() => PublicKey.parse('368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43ccag')).toThrow(); // Invalid hex
      expect(() => PublicKey.parse('368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43cc')).toThrow(); // Too short
      expect(() => PublicKey.parse('368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43ccaa1')).toThrow(); // Too long
      expect(() => PublicKey.parse('')).toThrow(); // Empty
    });
  });

  describe('AgentId', () => {
    it('should accept valid agent IDs', () => {
      const validAgents = [
        'Orchestrator', 'Architect', 'Developer', 'Tester', 'Security',
        'DevOps', 'Product', 'Docs', 'Support', 'Intake'
      ];

      for (const agent of validAgents) {
        expect(AgentId.parse(agent)).toBe(agent);
      }
    });

    it('should reject invalid agent IDs', () => {
      expect(() => AgentId.parse('InvalidAgent')).toThrow();
      expect(() => AgentId.parse('developer')).toThrow(); // Wrong case
      expect(() => AgentId.parse('Blueprint')).toThrow(); // Old agent name
      expect(() => AgentId.parse('')).toThrow();
    });
  });

  describe('TxHash and BlockHash', () => {
    const validHash = 'a1b2c3d4e5f67890123456789012345678901234567890123456789012345678';

    it('should accept valid hashes', () => {
      expect(TxHash.parse(validHash)).toBe(validHash);
      expect(BlockHash.parse(validHash)).toBe(validHash);
      expect(TxHash.parse(validHash.toUpperCase())).toBe(validHash.toUpperCase());
    });

    it('should reject invalid hashes', () => {
      expect(() => TxHash.parse('invalid')).toThrow();
      expect(() => TxHash.parse(validHash + 'extra')).toThrow();
      expect(() => TxHash.parse(validHash.slice(0, -1))).toThrow();
      expect(() => BlockHash.parse('xyz' + validHash.slice(3))).toThrow();
    });
  });

  describe('CapabilityName', () => {
    it('should accept valid capability names', () => {
      expect(CapabilityName.parse('TRANSFER')).toBe('TRANSFER');
      expect(CapabilityName.parse('coin.TRANSFER')).toBe('coin.TRANSFER');
      expect(CapabilityName.parse('dao-token.VOTE-CAST')).toBe('dao-token.VOTE-CAST');
      expect(CapabilityName.parse('my_capability')).toBe('my_capability');
    });

    it('should reject invalid capability names', () => {
      expect(() => CapabilityName.parse('123invalid')).toThrow(); // Starts with number
      expect(() => CapabilityName.parse('invalid@name')).toThrow(); // Invalid character
      expect(() => CapabilityName.parse('')).toThrow(); // Empty
      expect(() => CapabilityName.parse('a'.repeat(257))).toThrow(); // Too long
    });
  });

  describe('ModuleName', () => {
    it('should accept valid module names', () => {
      expect(ModuleName.parse('coin.coin')).toBe('coin.coin');
      expect(ModuleName.parse('pact-community.dao-token')).toBe('pact-community.dao-token');
      expect(ModuleName.parse('ns_1234.my_module')).toBe('ns_1234.my_module');
    });

    it('should reject invalid module names', () => {
      expect(() => ModuleName.parse('invalid')).toThrow(); // No namespace
      expect(() => ModuleName.parse('ns.')).toThrow(); // Empty module part
      expect(() => ModuleName.parse('.module')).toThrow(); // Empty namespace
      expect(() => ModuleName.parse('123.module')).toThrow(); // Namespace starts with number
      expect(() => ModuleName.parse('ns.123module')).toThrow(); // Module starts with number
      expect(() => ModuleName.parse('')).toThrow(); // Empty
    });
  });

  describe('KeysetName', () => {
    it('should accept valid keyset names', () => {
      expect(KeysetName.parse('admin')).toBe('admin');
      expect(KeysetName.parse('ns.governance')).toBe('ns.governance');
      expect(KeysetName.parse('user_keyset')).toBe('user_keyset');
      expect(KeysetName.parse('keyset-1')).toBe('keyset-1');
    });

    it('should reject invalid keyset names', () => {
      expect(() => KeysetName.parse('')).toThrow(); // Empty
      expect(() => KeysetName.parse('keyset@invalid')).toThrow(); // Invalid character
      expect(() => KeysetName.parse('a'.repeat(257))).toThrow(); // Too long
    });
  });

  describe('GasLimit', () => {
    it('should accept valid gas limits', () => {
      expect(GasLimit.parse(1000)).toBe(1000);
      expect(GasLimit.parse(150000)).toBe(150000);
      expect(GasLimit.parse(1)).toBe(1);
    });

    it('should reject invalid gas limits', () => {
      expect(() => GasLimit.parse(0)).toThrow(); // Zero
      expect(() => GasLimit.parse(-1000)).toThrow(); // Negative
      expect(() => GasLimit.parse(150001)).toThrow(); // Exceeds KDA-CE limit
      expect(() => GasLimit.parse(1.5)).toThrow(); // Not integer
    });
  });

  describe('GasPrice', () => {
    it('should accept valid gas prices', () => {
      expect(GasPrice.parse(0.0000001)).toBe(0.0000001);
      expect(GasPrice.parse(1.5)).toBe(1.5);
      expect(GasPrice.parse(1000)).toBe(1000);
    });

    it('should reject invalid gas prices', () => {
      expect(() => GasPrice.parse(0)).toThrow(); // Zero
      expect(() => GasPrice.parse(-1)).toThrow(); // Negative
      expect(() => GasPrice.parse(1001)).toThrow(); // Too high
      expect(() => GasPrice.parse(0.00000001)).toThrow(); // Too small
    });
  });

  describe('TTL', () => {
    it('should accept valid TTL values', () => {
      expect(TTL.parse(300)).toBe(300); // 5 minutes
      expect(TTL.parse(3600)).toBe(3600); // 1 hour
      expect(TTL.parse(86400)).toBe(86400); // 24 hours
      expect(TTL.parse(1)).toBe(1); // 1 second
    });

    it('should reject invalid TTL values', () => {
      expect(() => TTL.parse(0)).toThrow(); // Zero
      expect(() => TTL.parse(-300)).toThrow(); // Negative
      expect(() => TTL.parse(86401)).toThrow(); // Exceeds 24 hours
      expect(() => TTL.parse(300.5)).toThrow(); // Not integer
    });
  });

  describe('CreationTime', () => {
    it('should accept valid Unix timestamps', () => {
      expect(CreationTime.parse(1609459200)).toBe(1609459200); // Jan 1, 2021
      expect(CreationTime.parse(1714521600)).toBe(1714521600); // Apr 30, 2024
      expect(CreationTime.parse(1)).toBe(1); // Unix epoch start
    });

    it('should reject invalid timestamps', () => {
      expect(() => CreationTime.parse(0)).toThrow(); // Zero
      expect(() => CreationTime.parse(-1)).toThrow(); // Negative
      expect(() => CreationTime.parse(1.5)).toThrow(); // Not integer
    });
  });
});