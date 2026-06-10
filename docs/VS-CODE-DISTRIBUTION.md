# VS Code Distribution Path for pact-mcp

This document outlines practical ways to deliver Pact Community MCP servers to developers through VS Code.

## Distribution Options

1. Thin extension + external Node runtime
- Package only VS Code glue and MCP configuration templates.
- Depend on user-managed Node + pnpm installation.
- Pros: smaller extension, faster publish cycle.
- Cons: host environment drift risk.

2. Bundled extension with embedded server artifacts
- Build and include `packages/*/dist` outputs in the extension package.
- Ship curated `.mcp.json` templates in extension assets.
- Pros: deterministic runtime for users.
- Cons: larger VSIX and stricter update process.

3. Hybrid bootstrap extension (recommended)
- Ship configuration templates in the extension.
- On first run, install/update server packages to a controlled extension cache dir.
- Validate checksums and versions before activation.
- Pros: controlled updates without huge VSIX size.

## Recommended Extension Structure

```text
extension-root/
  package.json
  src/
    extension.ts
    mcp/
      resolver.ts
      install.ts
      validate.ts
      activateServers.ts
  resources/
    mcp/
      mcp.template.json
      profiles/
        devnet.json
        testnet06.readonly.json
        mainnet.readonly.json
  scripts/
    package-servers.mjs
```

Implementation notes:
- Keep devnet as the default active profile.
- Keep testnet06/mainnet profile files present but disabled unless explicit user opt-in is implemented.
- Public profiles must remain read-only (`PROFILE_WRITE_BLOCKED` on mutating tools).
- Write generated user config to workspace-local settings, never overwrite existing user customizations silently.

## Marketplace Publication Prerequisites

1. Publisher setup
- Create a verified Azure DevOps publisher.
- Reserve extension ID naming (`pact-community.pact-mcp`).

2. Compliance and legal
- Include LICENSE, privacy statement, and telemetry disclosure.
- Document subprocess/network behavior for MCP binaries.

3. Build integrity
- Reproducible builds with locked dependencies.
- CI must run `pnpm build`, `pnpm typecheck`, and `pnpm test` before packaging.

4. Security review
- Confirm no unsafe default network broadening.
- Ensure mutating operations remain opt-in (`PACT_COMMUNITY_DEVNET_ALLOW_*`).

## Security and Update Strategy

- Default-safe profiles:
  - Ship only devnet profile enabled by default.
  - Ship testnet06/mainnet entries as opt-in disabled read-only profiles.
  - Keep lifecycle-mutating devnet actions disabled unless explicit env flags are set.
- Signed release pipeline:
  - Tag-based releases from protected branch.
  - Publish VSIX only from CI after full checks.
- Update channels:
  - Stable channel for Marketplace.
  - Optional prerelease channel for profile refinements that preserve read-only public safety.
- Rollback:
  - Keep previous known-good server bundle in extension cache.
  - Fall back automatically if startup smoke checks fail after update.

## Suggested Developer Flow

1. Install extension.
2. Run command: `Pact MCP: Initialize Workspace Config`.
3. Extension writes a valid `.mcp.json` template with `<workspace-root>` placeholders.
4. Developer replaces placeholders and starts servers.
5. Extension runs quick smoke checks (`tools/list`) and reports readiness.
