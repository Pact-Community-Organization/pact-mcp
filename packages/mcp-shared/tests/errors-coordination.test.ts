/**
 * @fileoverview Tests for coordination-related ErrorCodes added for
 *               @pact-community/mcp-coordination. Kept in a separate file so the
 *               original 151 assertions in errors.test.ts remain untouched.
 */

import { describe, it, expect } from 'vitest';
import { ErrorCodes, McpToolError } from '../src/errors.js';

describe('ErrorCodes (coordination additions)', () => {
  it('exposes NOT_FOUND', () => {
    expect(ErrorCodes.NOT_FOUND).toBe('NOT_FOUND');
  });
  it('exposes LOCK_HELD', () => {
    expect(ErrorCodes.LOCK_HELD).toBe('LOCK_HELD');
  });
  it('exposes ARTIFACT_NOT_FOUND', () => {
    expect(ErrorCodes.ARTIFACT_NOT_FOUND).toBe('ARTIFACT_NOT_FOUND');
  });
  it('exposes UNKNOWN_AGENT', () => {
    expect(ErrorCodes.UNKNOWN_AGENT).toBe('UNKNOWN_AGENT');
  });
  it('exposes COORD_ROOT_INVALID', () => {
    expect(ErrorCodes.COORD_ROOT_INVALID).toBe('COORD_ROOT_INVALID');
  });
  it('is still frozen (immutable) after additions', () => {
    expect(Object.isFrozen(ErrorCodes)).toBe(true);
  });
  it('new codes work as McpToolError code arg', () => {
    const err = new McpToolError(ErrorCodes.LOCK_HELD, 'held', false);
    expect(err.code).toBe('LOCK_HELD');
  });
});
