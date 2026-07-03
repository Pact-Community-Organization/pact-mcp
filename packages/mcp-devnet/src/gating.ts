/**
 * @fileoverview Lifecycle gating — `LIFECYCLE_FORBIDDEN` and
 *               `VOLUME_WIPE_FORBIDDEN`.
 */

import { McpToolError } from '@pact-community/mcp-shared';

/** Resolved runtime flags read from the environment at startup. */
export interface LifecycleFlags {
  /** PACT_COMMUNITY_DEVNET_ALLOW_LIFECYCLE === "true" */
  readonly lifecycle: boolean;
  /** PACT_COMMUNITY_DEVNET_ALLOW_VOLUME_WIPE === "true" */
  readonly volumeWipe: boolean;
}

export function assertLifecycleAllowed(flags: LifecycleFlags): void {
  if (!flags.lifecycle) {
    throw new McpToolError(
      'LIFECYCLE_FORBIDDEN',
      "Destructive devnet operations require PACT_COMMUNITY_DEVNET_ALLOW_LIFECYCLE='true'",
      false
    );
  }
}

export function assertVolumeWipeAllowed(flags: LifecycleFlags): void {
  if (!flags.volumeWipe) {
    throw new McpToolError(
      'VOLUME_WIPE_FORBIDDEN',
      "Volume wipe requires PACT_COMMUNITY_DEVNET_ALLOW_VOLUME_WIPE='true'",
      false
    );
  }
}
