/**
 * @fileoverview Shared Zod schemas for Pact Community MCP servers
 * @author Developer
 * @description Common validation schemas for KDA-CE blockchain data
 */

import { z } from 'zod';

/**
 * [Developer] Kadena chain ID (0-19 for KDA-CE)
 */
export const ChainId = z.number().int().min(0).max(19);

/**
 * [Developer] Network identifiers for KDA-CE
 */
export const NetworkId = z.enum(['development', 'testnet06', 'mainnet01']);

/**
 * [Developer] Pact account name validation
 * 
 * Based on Pact account naming rules:
 * - 3-256 characters
 * - Alphanumeric, hyphens, underscores, dots, colons (for k: prefix)
 */
export const AccountName = z
  .string()
  .min(3)
  .max(256)
  .regex(/^[a-zA-Z0-9._:-]+$/, 'Account name can only contain alphanumeric characters, dots, hyphens, underscores, and colons');

/**
 * [Developer] Pact decimal string format
 * 
 * Matches Pact decimal representation: optional sign, digits, optional decimal point and more digits
 */
export const PactDecimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'Must be a valid decimal string');

/**
 * [Developer] Kadena public key (64-character hex)
 */
export const PublicKey = z
  .string()
  .length(64)
  .regex(/^[a-fA-F0-9]+$/, 'Must be 64-character hexadecimal string');

/**
 * [Developer] Pact Community agent identifiers
 */
export const AgentId = z.enum([
  'Orchestrator',
  'Architect', 
  'Developer',
  'Tester',
  'Security',
  'DevOps',
  'Product',
  'Docs',
  'Support',
  'Intake'
]);

/**
 * [Developer] Transaction hash (64-character hex)
 */
export const TxHash = z
  .string()
  .length(64)
  .regex(/^[a-fA-F0-9]+$/, 'Must be 64-character hexadecimal transaction hash');

/**
 * [Developer] Block hash (64-character hex)  
 */
export const BlockHash = z
  .string()
  .length(64)
  .regex(/^[a-fA-F0-9]+$/, 'Must be 64-character hexadecimal block hash');

/**
 * [Developer] Pact capability name
 */
export const CapabilityName = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z][a-zA-Z0-9._-]*$/, 'Capability name must start with letter and contain only alphanumeric, dots, hyphens, underscores');

/**
 * [Developer] Module name (namespace.module format)
 */
export const ModuleName = z
  .string()
  .min(3)
  .max(512)
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*\.[a-zA-Z][a-zA-Z0-9_-]*$/, 'Module name must be in format: namespace.module (namespace must start with letter)');

/**
 * [Developer] Keyset name validation
 */
export const KeysetName = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Keyset name can only contain alphanumeric characters, dots, hyphens, and underscores');

/**
 * [Developer] Gas limit (must not exceed KDA-CE limit)
 */
export const GasLimit = z
  .number()
  .int()
  .positive()
  .max(150_000, 'Gas limit cannot exceed 150,000 on KDA-CE');

/**
 * [Developer] Gas price (typical range for KDA-CE)
 */
export const GasPrice = z
  .number()
  .positive()
  .min(0.0000001)
  .max(1000);

/**
 * [Developer] TTL in seconds (reasonable bounds)
 */
export const TTL = z
  .number()
  .int()
  .positive()
  .max(86400, 'TTL cannot exceed 24 hours'); // 24 hours max

/**
 * [Developer] Creation time (Unix timestamp in seconds)
 */
export const CreationTime = z
  .number()
  .int()
  .positive();

// [Developer] Type exports for TypeScript usage
export type ChainIdType = z.infer<typeof ChainId>;
export type NetworkIdType = z.infer<typeof NetworkId>;
export type AccountNameType = z.infer<typeof AccountName>;
export type PactDecimalType = z.infer<typeof PactDecimal>;
export type PublicKeyType = z.infer<typeof PublicKey>;
export type AgentIdType = z.infer<typeof AgentId>;
export type TxHashType = z.infer<typeof TxHash>;
export type BlockHashType = z.infer<typeof BlockHash>;
export type CapabilityNameType = z.infer<typeof CapabilityName>;
export type ModuleNameType = z.infer<typeof ModuleName>;
export type KeysetNameType = z.infer<typeof KeysetName>;
export type GasLimitType = z.infer<typeof GasLimit>;
export type GasPriceType = z.infer<typeof GasPrice>;
export type TTLType = z.infer<typeof TTL>;
export type CreationTimeType = z.infer<typeof CreationTime>;