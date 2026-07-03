# Using pact-mcp in VS Code

`@pact-community/mcp-pact` and `@pact-community/mcp-chainweb` are published to
npm and the official [MCP registry](https://registry.modelcontextprotocol.io),
so they work in VS Code (with GitHub Copilot) **today, without any extension.**

## Three ways to install (available now)

1. **One-click install links** — the "Install in VS Code" badges in the
   [README](../README.md#use-in-vs-code-one-click) open VS Code with the server
   config pre-filled. Nothing to build or maintain.

2. **MCP registry discovery** — open the **MCP Servers** view in VS Code and
   search; both servers appear because they are in the official registry.

3. **Command line** — `code --add-mcp '<json>'` (see the README for the exact
   payload).

For most users, this is the whole story. The servers run via `npx`, so VS Code
fetches them from npm on first use and keeps them current.

## Optional: a branded Marketplace extension

A published VS Code Marketplace *extension* is only worth building if you want a
**branded storefront presence** — a "Pact Community" tile that appears when
someone searches "Pact" or "Kadena" in the Extensions panel, with an icon,
screenshots, and an install count. It does **not** make the servers more
capable; the three methods above already register them with VS Code's MCP
subsystem.

If/when that presence is wanted, the modern approach is small — no bundled
runtime, no custom installer, no cache directory (all of which the pre-npm
design assumed and none of which is needed now that the servers are on npm):

### Prerequisites

- An **Azure DevOps** organization and a **Marketplace publisher** (e.g.
  `pact-community`) — free.
- A **Personal Access Token** scoped to *Marketplace → Manage*.
- The **`@vscode/vsce`** CLI (`npm i -g @vscode/vsce`).

### Extension shape

- `package.json` with `engines.vscode`, `publisher`, a 128×128 icon, and a
  `contributes.mcpServerDefinitionProviders` entry.
- ~100–200 lines implementing `McpServerDefinitionProvider`, whose whole job is
  to declare `npx -y @pact-community/mcp-pact` (and `…/mcp-chainweb`) and prompt
  for the workspace root. VS Code launches and manages them from there.
- `LICENSE` (Apache-2.0) and a `README` that becomes the storefront page.

### Publish

```bash
vsce login pact-community      # uses the PAT
vsce package                   # produces a .vsix
vsce publish                   # pushes to the Marketplace
```

Optionally verify a domain you own (e.g. `pact-community.org`) for the verified
publisher checkmark. Publishing should run from CI after the full test suite,
on a tagged release, so the extension version tracks the server versions.
