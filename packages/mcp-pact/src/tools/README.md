# 🔌 MCP Tool Registry & Modular Connector Architecture

In alignment with the modern, modular direction of the Model Context Protocol (MCP) ecosystem, specialized heavy computing engines (such as AST parsers, formal verification solvers, and iterative AI patchers) are decoupled into dedicated standalone plugins.

This allows the core MCP server to remain lightweight, sandboxed, and easily integrable, while providing full plug-and-play access to high-performance verification daemons.

---

## 🛡️ Formal Verification: `pact_seal_klub_prover` Connector Bridge

The [`seal-klub-prover.ts`](./seal-klub-prover.ts) tool acts as a secure connector bridge to the standalone **`@not-bob/seal-klub-prover`** plugin.

### 📥 Getting & Installing the Prover Plugin

The standalone prover engine is maintained and distributed at:
👉 **[https://github.com/NOtBobs-Emporium-Of-Wonder/Pact5-Seal-Klub-prover-v2.0](https://github.com/NOtBobs-Emporium-Of-Wonder/Pact5-Seal-Klub-prover-v2.0)**

#### 1. Global / CLI Installation
```bash
# Clone the standalone engine
git clone https://github.com/NOtBobs-Emporium-Of-Wonder/Pact5-Seal-Klub-prover-v2.0.git
cd Pact5-Seal-Klub-prover-v2.0

# Install dependencies & build
pnpm install
pnpm build

# Link globally for CLI usage
pnpm link --global
```

#### 2. Running as a Background Daemon
You can run the engine as a high-speed background HTTP daemon:
```bash
seal-klub-prover serve --port 3846
```

---

## 🛠️ Tool Architecture in this Directory

| File | Type | Description |
| :--- | :---: | :--- |
| [`seal-klub-prover.ts`](./seal-klub-prover.ts) | **Connector Bridge** | Bridges MCP clients to `@not-bob/seal-klub-prover` for formal SMT proofs, PQ guards, and A2A self-healing. |
| [`repl-run.ts`](./repl-run.ts) | Native Tool | Spawns sandboxed Pact 5 REPL runner. |
| [`repl-run-many.ts`](./repl-run-many.ts) | Native Tool | Batch runs multiple `.repl` test files concurrently. |
| [`module-scan.ts`](./module-scan.ts) | Native Tool | Scans Pact modules for language traps and structure. |
| [`gas-estimate.ts`](./gas-estimate.ts) | Native Tool | Calculates gas consumption profiles. |
| [`interface-diff.ts`](./interface-diff.ts) | Native Tool | Detects breaking changes in module signatures. |
| [`fmt-check.ts`](./fmt-check.ts) | Native Tool | Style & syntax formatting checker. |
