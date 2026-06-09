/**
 * @fileoverview Hardcoded agent → (compose file, devnet port) map.
 * @author Developer
 *
 * Callers pick an agent name; the server picks the compose file and port.
 * NEVER let tool input control file paths directly.
 */

/** Agents that own a devnet stack. */
export const AGENT_NAMES = ['Developer', 'Tester', 'Security'] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export interface AgentMapping {
  /** Lowercase slug used in compose file names. */
  readonly slug: string;
  /** Relative path from workspace root to the compose file. */
  readonly composeRelPath: string;
  /** Devnet Pact API port exposed on localhost. */
  readonly port: number;
  /** Regex pattern permitted for container_name entries in the compose file. */
  readonly containerNameRegex: RegExp;
}

/**
 * [Developer] Per-agent immutable mapping.
 *
 * Note: Developer's compose file is named `docker-compose.forge.yml` (legacy
 * from when the agent was called "Forge"). The workspace conventions file
 * documents this.
 */
export const AGENT_MAP: Readonly<Record<AgentName, AgentMapping>> = Object.freeze({
  Developer: {
    slug: 'forge',
    composeRelPath: 'pact-examples/docker-compose.forge.yml',
    port: 8081,
    containerNameRegex:
      /^devnet-(forge|tester|security|guardian)(?:-[a-z0-9-]+)?$/
  },
  Tester: {
    slug: 'tester',
    composeRelPath: 'pact-examples/docker-compose.tester.yml',
    port: 8082,
    containerNameRegex:
      /^devnet-(forge|tester|security|guardian)(?:-[a-z0-9-]+)?$/
  },
  Security: {
    slug: 'security',
    composeRelPath: 'pact-examples/docker-compose.security.yml',
    port: 8083,
    containerNameRegex:
      /^devnet-(forge|tester|security|guardian)(?:-[a-z0-9-]+)?$/
  }
});

/** Ports allowed by the network allowlist (8081/8082/8083). */
export const ALLOWED_DEVNET_ORIGINS: readonly string[] = Object.freeze([
  'http://localhost:8081',
  'http://localhost:8082',
  'http://localhost:8083'
]);
