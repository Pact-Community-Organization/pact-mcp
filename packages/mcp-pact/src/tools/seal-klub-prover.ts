/**
 * @fileoverview pact_seal_klub_prover tool — MCP Connector Bridge.
 * Delegates formal verification, AST parsing, invariant proofs, and A2A self-healing
 * to the standalone @not-bob/seal-klub-prover plugin module.
 *
 * Repository: https://github.com/NOtBobs-Emporium-Of-Wonder/Pact5-Seal-Klub-prover-v2.0
 */

import fs from "node:fs";
import { z } from "zod";
import { resolveInsideWorkspace, McpToolError } from "@pact-community/mcp-shared";
import {
  evaluateContractSource,
  runA2AHealingLoop,
  applyAutoPatches,
  type ProverResult,
  type InvariantProofResult,
  type A2AIterationLog,
  type AgentPatcherDelegate
} from "@not-bob/seal-klub-prover";

export {
  evaluateContractSource,
  runA2AHealingLoop,
  applyAutoPatches,
  type ProverResult,
  type InvariantProofResult,
  type A2AIterationLog,
  type AgentPatcherDelegate
};

export const SealKlubProverInputShape = {
  filePath: z
    .string()
    .describe("Path to the .pact smart contract file to formally verify (relative to workspace root)."),
  strictConservation: z
    .boolean()
    .default(true)
    .describe("Require mathematical proof of balance column conservation delta = 0.0 across all transfer paths."),
  verifyCapabilities: z
    .boolean()
    .default(true)
    .describe("Verify that all table mutation operations require scoped capability authorization."),
  verifyPostQuantumGuards: z
    .boolean()
    .default(true)
    .describe("Verify NIST FIPS 205 SLH-DSA post-quantum principal compatibility and entropy constraints."),
  autoHeal: z
    .boolean()
    .default(false)
    .describe("Enable iterative A2A self-healing loop to automatically patch detected violations until verified."),
  maxIterations: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe("Maximum number of A2A self-healing verification/patch iterations."),
  applyPatchesToFile: z
    .boolean()
    .default(false)
    .describe("If autoHeal is true, whether to write the final healed contract directly back to the file."),
  generateReport: z
    .boolean()
    .default(true)
    .describe("Generate a comprehensive GitHub-flavored Markdown formal verification audit report."),
  source: z
    .string()
    .optional()
    .describe("Optional inline Pact source code to verify directly.")
};

export const SealKlubProverInputSchema = z.object(SealKlubProverInputShape);

export type SealKlubProverInput = z.infer<typeof SealKlubProverInputSchema>;

export type SealKlubProverResult = ProverResult;

export interface SealKlubProverContext {
  workspaceRoot: string;
}

/**
 * Creates the MCP pact_seal_klub_prover tool handler.
 */
export function createSealKlubProverTool(ctx: SealKlubProverContext) {
  return async function sealKlubProver(
    args: unknown
  ): Promise<{ content: SealKlubProverResult[] }> {
    const parsed = SealKlubProverInputSchema.safeParse(args);
    if (!parsed.success) {
      throw new McpToolError(
        "INVALID_PARAMS",
        `Invalid pact_seal_klub_prover arguments: ${parsed.error.message}`,
        false
      );
    }
    const input = parsed.data;

    let source = input.source;
    let targetPath = input.filePath;
    let resolvedFilePath: string | null = null;

    if (!source) {
      resolvedFilePath = resolveInsideWorkspace(ctx.workspaceRoot, input.filePath);
      if (!fs.existsSync(resolvedFilePath)) {
        throw new McpToolError(
          "FILE_NOT_FOUND",
          `Contract file not found inside workspace: '${input.filePath}'`,
          false
        );
      }
      try {
        source = fs.readFileSync(resolvedFilePath, "utf-8");
        targetPath = input.filePath;
      } catch (err) {
        throw new McpToolError(
          "READ_FAILED",
          `Failed to read contract file: ${String(err)}`,
          false
        );
      }
    }

    let finalSource = source;
    let autoHealEngaged = false;
    let healingIterations = 0;
    let healingHistory: A2AIterationLog[] | undefined;
    let healedFileWritten = false;
    let evaluation: ReturnType<typeof evaluateContractSource>;

    if (input.autoHeal) {
      autoHealEngaged = true;
      const a2aResult = await runA2AHealingLoop(source, targetPath, {
        maxIterations: input.maxIterations,
        strictConservation: input.strictConservation,
        verifyCapabilities: input.verifyCapabilities,
        verifyPostQuantumGuards: input.verifyPostQuantumGuards
      });

      finalSource = a2aResult.finalSource;
      healingIterations = a2aResult.totalIterations;
      healingHistory = a2aResult.history;
      evaluation = a2aResult.finalEvaluation;

      if (input.applyPatchesToFile && resolvedFilePath && a2aResult.converged) {
        try {
          fs.writeFileSync(resolvedFilePath, finalSource, "utf-8");
          healedFileWritten = true;
        } catch (err) {
          throw new McpToolError(
            "WRITE_FAILED",
            `Failed to write healed contract: ${String(err)}`,
            false
          );
        }
      }
    } else {
      evaluation = evaluateContractSource(source, targetPath, {
        strictConservation: input.strictConservation,
        verifyCapabilities: input.verifyCapabilities,
        verifyPostQuantumGuards: input.verifyPostQuantumGuards
      });
    }

    const { moduleName, proofs, provenCount, violationCount } = evaluation;
    const formalProofStatus: "MATHEMATICALLY_VERIFIED" | "VERIFICATION_FAILED" =
      violationCount === 0 ? "MATHEMATICALLY_VERIFIED" : "VERIFICATION_FAILED";

    let report: string | undefined;
    if (input.generateReport !== false) {
      const proofRows = proofs
        .map(
          p =>
            `| ${p.ruleId || "SMT"} | \`${p.invariant}\` | **${p.status}** | \`${p.severity}\` | ${p.details} | ${
              p.location ? `L${p.location.line}` : "-"
            } |`
        )
        .join("\n");

      let a2aSection = "";
      if (autoHealEngaged && healingHistory) {
        const histRows = healingHistory
          .map(
            h =>
              `| Iteration ${h.iteration} | ${h.initialViolations} | ${h.patchesApplied.join("<br>")} | ${
                h.remainingViolations
              } | ${h.resolvedRules.join(", ") || "None"} |`
          )
          .join("\n");

        a2aSection = `
### 🔄 A2A Self-Healing Iteration Log

| Iteration | Initial Violations | Patches Applied | Remaining Violations | Resolved Invariants |
| :---: | :---: | :--- | :---: | :--- |
${histRows}
`;
      }

      report = `
# 🛡️ Pact5-seal_Klub-Prover-v2.0 Formal Verification Certificate
**Module**: \`${moduleName || "top-level"}\`  
**File**: \`${targetPath}\`  
**Engine**: \`Pact5-seal_Klub-Prover-v2.0\`  
**Contributor**: \`not_bob & seal_klub\`  
**Status**: **${formalProofStatus}** (${provenCount} Invariants Proven, ${violationCount} Violations)
${autoHealEngaged ? `**A2A Auto-Heal**: Engaged (${healingIterations} Iterations, Converged: ${formalProofStatus === "MATHEMATICALLY_VERIFIED"})` : ""}

---

### 📊 Verification Proof Matrix

| Rule ID | Invariant | Status | Severity | Specification Details | Location |
| :--- | :--- | :---: | :---: | :--- | :---: |
${proofRows}
${a2aSection}
---
*Verified using Pact5-seal_Klub-Prover-v2.0 AST Tokenizer, A2A Iterative Healer, SMT Balance Conservation Model, and NIST FIPS 205 Post-Quantum Security System.*
`;
    }

    return {
      content: [
        {
          engine: "Pact5-seal_Klub-Prover-v2.0",
          version: "2.0.0",
          contributor: "not_bob & seal_klub",
          file: targetPath,
          moduleName,
          formalProofStatus,
          totalInvariantsChecked: proofs.length,
          provenCount,
          violationCount,
          proofs,
          autoHealEngaged,
          healingIterations,
          healingHistory,
          healedSource: autoHealEngaged ? finalSource : undefined,
          healedFileWritten,
          summary:
            formalProofStatus === "MATHEMATICALLY_VERIFIED"
              ? `Formal verification succeeded for ${targetPath}.${autoHealEngaged ? ` (A2A healed in ${healingIterations} iterations).` : ""} All ${provenCount} invariants mathematically closed.`
              : `Formal verification detected ${violationCount} invariant violations in ${targetPath}. Review proof matrix for details.`,
          report
        }
      ]
    };
  };
}
