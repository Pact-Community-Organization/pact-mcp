/**
 * @fileoverview coord.status_set — set agent status.
 * @author Developer
 */

import {
  StatusSetInputShape,
  StatusSetInputSchema,
  StatusSchema,
  type Status
} from '../schemas/status.js';
import { writeJsonAtomic } from '../fs/atomic.js';
import type { CoordPaths } from '../fs/paths.js';
import { sanitizeFields } from '../sanitize.js';

export { StatusSetInputShape };

export interface StatusSetDeps {
  paths: CoordPaths;
  now?: () => Date;
}

export function createStatusSetTool(deps: StatusSetDeps) {
  const now = deps.now ?? (() => new Date());
  return async (args: unknown): Promise<{ content: unknown[] }> => {
    const input = StatusSetInputSchema.parse(args);
    const nowIso = now().toISOString();
    const status: Status = StatusSchema.parse({
      agent: input.agent,
      state: input.state,
      note: input.note,
      updatedAt: nowIso
    });
    const target = deps.paths.statusFile(input.agent);
    await writeJsonAtomic(target, status);
    return {
      content: [
        {
          status: sanitizeFields(status, ['note'])
        }
      ]
    };
  };
}
