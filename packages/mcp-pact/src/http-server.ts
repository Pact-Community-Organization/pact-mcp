/**
 * @fileoverview HTTP REST API server for pact-mcp and seal-klub-prover.
 * Exposes RESTful endpoints for formal verification, A2A self-healing, rule inspection, and MCP tools.
 */

import http from "node:http";
import { URL } from "node:url";
import {
  evaluateContractSource,
  runA2AHealingLoop,
  applyAutoPatches,
  createSealKlubProverTool,
  type InvariantProofResult
} from "./tools/seal-klub-prover.js";
import { type ResolvedConfig } from "./server.js";

export const PACT_SECURITY_RULES = [
  {
    id: "PACT001",
    name: "Capability Scoping & Guard Enforcement",
    type: "capability-authorization",
    severity: "HIGH",
    description: "Ensures state mutations and sensitive operations require scoped capability authorization."
  },
  {
    id: "PACT002",
    name: "Least-Privilege Keyset Governance",
    type: "keyset-governance",
    severity: "MEDIUM",
    description: "Prohibits overly permissive keysets such as (keys-any)."
  },
  {
    id: "PACT003",
    name: "Zero Hardcoded Secrets / Private Keys",
    type: "hardcoded-secret",
    severity: "CRITICAL",
    description: "Detects raw hex private keys, API secrets, and unmanaged tokens embedded in contract code."
  },
  {
    id: "PACT004",
    name: "Time Manipulation & Block-Time Equality",
    type: "time-manipulation",
    severity: "MEDIUM",
    description: "Prohibits exact equality on block timestamps to prevent miner manipulation."
  },
  {
    id: "PACT005",
    name: "Token Arithmetic Precision",
    type: "arithmetic-precision",
    severity: "LOW",
    description: "Enforces explicit rounding (round, floor, ceiling) on token arithmetic."
  },
  {
    id: "PACT006",
    name: "External Input Validation",
    type: "input-validation",
    severity: "HIGH",
    description: "Requires explicit bounds enforcement on parameters read via read-msg."
  },
  {
    id: "PACT007",
    name: "Cross-Module Scoping",
    type: "cross-module-call",
    severity: "LOW",
    description: "Ensures external module interactions occur under explicit capability authorization."
  },
  {
    id: "PACT008",
    name: "Event Emission Ordering (CEI)",
    type: "event-ordering",
    severity: "MEDIUM",
    description: "Enforces that state writes precede event emissions to prevent rollback observer desync."
  },
  {
    id: "PACT009",
    name: "Unbound Cross-Module Return Value",
    type: "cross-module-call",
    severity: "LOW",
    description: "Requires binding of external call returns to prevent silent failures."
  },
  {
    id: "PACT010",
    name: "Guarded Capability Declarations",
    type: "capability-authorization",
    severity: "HIGH",
    description: "Prevents defcap declarations without keyset, guard, or @managed constraints."
  },
  {
    id: "PACT011",
    name: "Checks-Effects-Interactions (Reentrancy Prevention)",
    type: "reentrancy-risk",
    severity: "HIGH",
    description: "Enforces internal state updates before external cross-module invocations."
  },
  {
    id: "PACT012",
    name: "Non-Trivial Governance Capability",
    type: "keyset-governance",
    severity: "CRITICAL",
    description: "Prohibits trivially passable governance checks like (enforce true)."
  },
  {
    id: "SMT-001",
    name: "SMT Balance Column Conservation",
    type: "balance-conservation",
    severity: "CRITICAL",
    description: "Proves algebraic conservation of column delta balance = 0.0 across all paths."
  },
  {
    id: "SMT-002",
    name: "Strict Non-Negative Amount Domain",
    type: "non-negative-amounts",
    severity: "HIGH",
    description: "Proves that all mutating operations require strictly positive amount inputs (amount > 0.0)."
  },
  {
    id: "SMT-003",
    name: "Node Consensus Safety (Bind-Before-Enforce)",
    type: "node-safety",
    severity: "HIGH",
    description: "Prohibits dynamic database reads inside enforce conditions to avoid mining node forks."
  },
  {
    id: "PQ-001",
    name: "NIST FIPS 205 SLH-DSA Post-Quantum Guard Scheme",
    type: "quantum-safety",
    severity: "INFO",
    description: "Validates post-quantum q: / x: principal scheme compatibility."
  }
];

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  const json = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  res.end(json);
}

function parseBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        reject(new Error("Request payload too large (> 5MB)"));
      }
    });
    req.on("end", () => {
      try {
        if (!raw.trim()) {
          resolve({} as T);
        } else {
          resolve(JSON.parse(raw) as T);
        }
      } catch (err) {
        reject(new Error("Invalid JSON in request body"));
      }
    });
    req.on("error", reject);
  });
}

export function createHttpServer(config: ResolvedConfig): http.Server {
  const proverTool = createSealKlubProverTool({ workspaceRoot: config.workspaceRoot });

  const server = http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      });
      res.end();
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const pathname = url.pathname;

      // 1. GET /v1/health or /health
      if (req.method === "GET" && (pathname === "/v1/health" || pathname === "/health")) {
        return sendJson(res, 200, {
          status: "healthy",
          engine: "Pact5-seal_Klub-Prover-v2.0",
          version: "2.0.0",
          contributor: "not_bob & seal_klub",
          uptimeSeconds: Math.floor(process.uptime()),
          workspaceRoot: config.workspaceRoot,
          capabilities: {
            formalVerification: true,
            autoHealA2A: true,
            rulesCount: PACT_SECURITY_RULES.length,
            postQuantumFips205: true,
            smtConservation: true
          }
        });
      }

      // 2. GET /v1/prover/rules
      if (req.method === "GET" && (pathname === "/v1/prover/rules" || pathname === "/api/rules")) {
        return sendJson(res, 200, {
          count: PACT_SECURITY_RULES.length,
          rules: PACT_SECURITY_RULES
        });
      }

      // 3. POST /v1/prover/verify
      if (req.method === "POST" && (pathname === "/v1/prover/verify" || pathname === "/api/verify")) {
        const body = await parseBody<{
          source?: string;
          filePath?: string;
          strictConservation?: boolean;
          verifyCapabilities?: boolean;
          verifyPostQuantumGuards?: boolean;
          generateReport?: boolean;
        }>(req);

        const result = await proverTool({
          filePath: body.filePath || "inline.pact",
          source: body.source,
          strictConservation: body.strictConservation ?? true,
          verifyCapabilities: body.verifyCapabilities ?? true,
          verifyPostQuantumGuards: body.verifyPostQuantumGuards ?? true,
          generateReport: body.generateReport ?? true,
          autoHeal: false
        });

        return sendJson(res, 200, result.content[0]);
      }

      // 4. POST /v1/prover/heal
      if (req.method === "POST" && (pathname === "/v1/prover/heal" || pathname === "/api/heal")) {
        const body = await parseBody<{
          source?: string;
          filePath?: string;
          maxIterations?: number;
          strictConservation?: boolean;
          applyPatchesToFile?: boolean;
        }>(req);

        const result = await proverTool({
          filePath: body.filePath || "inline.pact",
          source: body.source,
          strictConservation: body.strictConservation ?? true,
          autoHeal: true,
          maxIterations: body.maxIterations ?? 5,
          applyPatchesToFile: body.applyPatchesToFile ?? false
        });

        return sendJson(res, 200, result.content[0]);
      }

      // 5. POST /v1/prover/patch-proposal
      if (req.method === "POST" && pathname === "/v1/prover/patch-proposal") {
        const body = await parseBody<{
          source: string;
          violations?: InvariantProofResult[];
        }>(req);

        let violations = body.violations;
        if (!violations) {
          const evalResult = evaluateContractSource(body.source, "proposal.pact");
          violations = evalResult.proofs.filter(p => p.status === "VIOLATION_DETECTED" || p.status === "UNCONSTRAINED");
        }

        const { patchedSource, appliedPatches } = applyAutoPatches(body.source, violations);

        return sendJson(res, 200, {
          appliedPatches,
          patchCount: appliedPatches.length,
          patchedSource
        });
      }

      // 6. POST /v1/prover/a2a-loop
      if (req.method === "POST" && pathname === "/v1/prover/a2a-loop") {
        const body = await parseBody<{
          source: string;
          filePath?: string;
          maxIterations?: number;
          strictConservation?: boolean;
        }>(req);

        const loopResult = await runA2AHealingLoop(body.source, body.filePath || "a2a.pact", {
          maxIterations: body.maxIterations ?? 5,
          strictConservation: body.strictConservation ?? true
        });

        return sendJson(res, 200, {
          converged: loopResult.converged,
          totalIterations: loopResult.totalIterations,
          history: loopResult.history,
          finalSource: loopResult.finalSource,
          finalProofStatus: loopResult.finalEvaluation.violationCount === 0 ? "MATHEMATICALLY_VERIFIED" : "VERIFICATION_FAILED",
          remainingViolations: loopResult.finalEvaluation.violationCount,
          provenCount: loopResult.finalEvaluation.provenCount
        });
      }

      // 404 Not Found
      return sendJson(res, 404, {
        error: "NOT_FOUND",
        message: `Route not found: ${req.method} ${pathname}`,
        availableEndpoints: [
          "GET /v1/health",
          "GET /v1/prover/rules",
          "POST /v1/prover/verify",
          "POST /v1/prover/heal",
          "POST /v1/prover/patch-proposal",
          "POST /v1/prover/a2a-loop"
        ]
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, 500, {
        error: "INTERNAL_SERVER_ERROR",
        message: msg
      });
    }
  });

  return server;
}
