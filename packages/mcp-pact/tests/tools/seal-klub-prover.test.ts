import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSealKlubProverTool,
  runA2AHealingLoop,
  applyAutoPatches
} from "../../src/tools/seal-klub-prover.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../fixtures");

describe("pact_seal_klub_prover (Pact5-seal_Klub-Prover-v2.0)", () => {
  const prover = createSealKlubProverTool({ workspaceRoot });

  it("detects all 12 full security scanner rules (PACT001 to PACT012) with code patches", async () => {
    const buggyContract = `
      (module buggy-contract GOV
        ; PACT012: Trivial governance
        (defcap GOV () (enforce true "always pass"))

        ; PACT010: Unguarded defcap
        (defcap UNGUARDED-CAP ()
          (let ((x 1)) x))

        (defschema s balance:decimal)
        (deftable tbl:{s})

        ; PACT003: Hardcoded private key / secret
        (defconst SECRET_KEY "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")

        ; PACT001: Sensitive function with state mutation lacks capability check
        (defun admin-withdraw (acc:string)
          (update tbl acc {"balance": 0.0}))

        ; PACT002: Overly permissive keyset
        (defun test-pact002 ()
          (define-keyset "open-ks" (keys-any)))

        ; PACT004: Unsafe exact block-time equality
        (defun test-pact004 (deadline:time)
          (enforce (= (at 'block-time (chain-data)) deadline) "time"))

        ; PACT005: Token arithmetic without explicit rounding
        (defun transfer-tokens (price:decimal qty:decimal)
          (* price qty))

        ; PACT006: External input without enforce validation
        (defun test-pact006 ()
          (read-msg "unvalidated"))

        ; PACT007 & PACT009: Unbound cross-module call without capability
        (defun test-pact007 ()
          (oracle.get-price "KDA"))

        ; PACT008: Event emitted before state write
        (defun test-pact008 (acc:string)
          (emit-event (TRANSFER acc))
          (update tbl acc {"balance": 0.0}))

        ; PACT011: Check-Effects-Interactions (external call before state write)
        (defun test-pact011 (acc:string amt:decimal)
          (coin.transfer "vault" acc amt)
          (update tbl acc {"balance": 100.0}))
      )
    `;

    const res = await prover({
      filePath: "buggy.pact",
      source: buggyContract,
      strictConservation: false,
      verifyCapabilities: true,
      verifyPostQuantumGuards: true
    });

    const p = res.content[0]!;
    expect(p.formalProofStatus).toBe("VERIFICATION_FAILED");
    expect(p.engine).toBe("Pact5-seal_Klub-Prover-v2.0");
    expect(p.contributor).toBe("not_bob & seal_klub");

    const ruleIds = p.proofs.map(pr => pr.ruleId).filter(Boolean);
    expect(ruleIds).toContain("PACT001");
    expect(ruleIds).toContain("PACT002");
    expect(ruleIds).toContain("PACT003");
    expect(ruleIds).toContain("PACT004");
    expect(ruleIds).toContain("PACT005");
    expect(ruleIds).toContain("PACT006");
    expect(ruleIds).toContain("PACT007");
    expect(ruleIds).toContain("PACT008");
    expect(ruleIds).toContain("PACT009");
    expect(ruleIds).toContain("PACT010");
    expect(ruleIds).toContain("PACT011");
    expect(ruleIds).toContain("PACT012");

    // Verify code remediation patches and formal verification hints are present
    const p1 = p.proofs.find(pr => pr.ruleId === "PACT001")!;
    expect(p1.patchSnippet).toBeDefined();
    expect(p1.formalVerificationHint).toBeDefined();

    const p11 = p.proofs.find(pr => pr.ruleId === "PACT011")!;
    expect(p11.type).toBe("reentrancy-risk");
    expect(p11.patchSnippet).toBeDefined();
  });

  it("formally verifies clean contract with post-quantum guard and SMT balance conservation", async () => {
    const pqSource = `
      (module pq-token GOV
        (defcap GOV () (enforce-guard (read-keyset 'ks)))
        (defschema acc balance:decimal)
        (deftable accounts:{acc})
        @model [(property (= (column-delta 'balance) 0.0))]
        (defun transfer:string (from:string to:string amount:decimal)
          (enforce (> amount 0.0) "positive")
          (with-capability (GOV)
            (update accounts to {"balance": (round amount 12)})))
      )
    `;

    const res = await prover({
      filePath: "pq-token.pact",
      source: pqSource,
      strictConservation: true,
      verifyCapabilities: true,
      verifyPostQuantumGuards: true
    });

    const p = res.content[0]!;
    expect(p.formalProofStatus).toBe("MATHEMATICALLY_VERIFIED");
    expect(p.violationCount).toBe(0);
    expect(p.provenCount).toBeGreaterThan(0);
  });

  it("executes A2A self-healing loop to automatically resolve invariant violations", async () => {
    const unhealed = `
      (module auto-heal-target GOV
        (defcap GOV () (enforce true))
        (defschema acc balance:decimal)
        (deftable ledger:{acc})
        (defun transfer (from:string to:string amount:decimal)
          (enforce-keyset "admin-keyset")
          (let ((fee (* amount 0.01)))
            (update ledger to { "balance": amount })))
      )
    `;

    const res = await prover({
      filePath: "auto-heal.pact",
      source: unhealed,
      strictConservation: true,
      autoHeal: true,
      maxIterations: 5
    });

    const p = res.content[0]!;
    expect(p.autoHealEngaged).toBe(true);
    expect(p.healingIterations).toBeGreaterThan(0);
    expect(p.healingHistory).toBeDefined();
    expect(p.healingHistory!.length).toBeGreaterThan(0);
    expect(p.healedSource).toBeDefined();
    expect(p.formalProofStatus).toBe("MATHEMATICALLY_VERIFIED");
    expect(p.healedSource).toContain("(enforce (> amount 0.0)");
    expect(p.healedSource).toContain("(round (* amount 0.01) 12)");
  });

  it("supports programmatic runA2AHealingLoop with custom delegate", async () => {
    const source = `
      (module custom-loop GOV
        (defcap GOV () (enforce true))
        (defun transfer (from to amount)
          (update tbl to {"bal": amount}))
      )
    `;

    const result = await runA2AHealingLoop(source, "custom.pact", {
      maxIterations: 3,
      strictConservation: false,
      customPatcherDelegate: async (src, violations, iter) => {
        return src.replace("(enforce true)", '(enforce-guard (keyset-ref-guard "admin-ks"))');
      }
    });

    expect(result.history.length).toBeGreaterThan(0);
  });
});
