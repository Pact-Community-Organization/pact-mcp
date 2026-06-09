/**
 * @fileoverview Tests for devnet-related ErrorCodes added for
 *               @pact-community/mcp-devnet. Kept in a separate file so earlier
 *               error tests remain untouched.
 */

import { describe, it, expect } from 'vitest';
import { ErrorCodes, McpToolError } from '../src/errors.js';

describe('ErrorCodes (devnet additions)', () => {
  it('exposes LIFECYCLE_FORBIDDEN', () => {
    expect(ErrorCodes.LIFECYCLE_FORBIDDEN).toBe('LIFECYCLE_FORBIDDEN');
  });
  it('exposes VOLUME_WIPE_FORBIDDEN', () => {
    expect(ErrorCodes.VOLUME_WIPE_FORBIDDEN).toBe('VOLUME_WIPE_FORBIDDEN');
  });
  it('exposes COMPOSE_FILE_MISSING', () => {
    expect(ErrorCodes.COMPOSE_FILE_MISSING).toBe('COMPOSE_FILE_MISSING');
  });
  it('exposes COMPOSE_FILE_SUSPICIOUS', () => {
    expect(ErrorCodes.COMPOSE_FILE_SUSPICIOUS).toBe('COMPOSE_FILE_SUSPICIOUS');
  });
  it('exposes DOCKER_NOT_FOUND', () => {
    expect(ErrorCodes.DOCKER_NOT_FOUND).toBe('DOCKER_NOT_FOUND');
  });
  it('exposes SPAWN_TIMEOUT', () => {
    expect(ErrorCodes.SPAWN_TIMEOUT).toBe('SPAWN_TIMEOUT');
  });
  it('is still frozen (immutable) after devnet additions', () => {
    expect(Object.isFrozen(ErrorCodes)).toBe(true);
  });
  it('new codes work as McpToolError code arg', () => {
    const err = new McpToolError(
      ErrorCodes.LIFECYCLE_FORBIDDEN,
      'not allowed',
      false
    );
    expect(err.code).toBe('LIFECYCLE_FORBIDDEN');
    expect(err.retryable).toBe(false);
  });
  it('SPAWN_TIMEOUT retryable error constructs correctly', () => {
    const err = new McpToolError(ErrorCodes.SPAWN_TIMEOUT, 'timeout', true);
    expect(err.code).toBe('SPAWN_TIMEOUT');
    expect(err.retryable).toBe(true);
  });
});
