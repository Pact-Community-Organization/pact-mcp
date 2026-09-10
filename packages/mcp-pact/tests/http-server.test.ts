import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHttpServer } from "../src/http-server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "./fixtures");

describe("HTTP REST API Endpoints", () => {
  let server: http.Server;
  let port: number;
  let baseUrl: string;

  beforeAll(async () => {
    server = createHttpServer({
      workspaceRoot,
      pactBin: "pact",
      lockfilePath: "tools.lock.json",
      childEnv: {}
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as { port: number };
        port = address.port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("GET /v1/health returns 200 and prover engine status", async () => {
    const res = await fetch(`${baseUrl}/v1/health`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.status).toBe("healthy");
    expect(data.engine).toBe("Pact5-seal_Klub-Prover-v2.0");
    expect(data.version).toBe("2.0.0");
    expect(data.capabilities.formalVerification).toBe(true);
    expect(data.capabilities.autoHealA2A).toBe(true);
  });

  it("GET /v1/prover/rules returns all security rules", async () => {
    const res = await fetch(`${baseUrl}/v1/prover/rules`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.count).toBeGreaterThanOrEqual(12);
    expect(data.rules.some((r: any) => r.id === "PACT001")).toBe(true);
    expect(data.rules.some((r: any) => r.id === "PACT012")).toBe(true);
  });

  it("POST /v1/prover/verify formally evaluates contract source", async () => {
    const buggyContract = `
      (module buggy-http GOV
        (defcap GOV () (enforce true))
        (defun transfer (acc:string amt:decimal)
          (update tbl acc {"bal": amt}))
      )
    `;

    const res = await fetch(`${baseUrl}/v1/prover/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: buggyContract,
        strictConservation: false
      })
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.formalProofStatus).toBe("VERIFICATION_FAILED");
    expect(data.violationCount).toBeGreaterThan(0);
    expect(data.report).toBeDefined();
  });

  it("POST /v1/prover/heal runs autonomous A2A healing loop", async () => {
    const unhealed = `
      (module auto-heal-http GOV
        (defcap GOV () (enforce true))
        (defun transfer (from:string to:string amount:decimal)
          (enforce-keyset "admin-keyset")
          (let ((fee (* amount 0.01)))
            (update ledger to { "balance": amount })))
      )
    `;

    const res = await fetch(`${baseUrl}/v1/prover/heal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: unhealed,
        strictConservation: true,
        maxIterations: 5
      })
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.autoHealEngaged).toBe(true);
    expect(data.formalProofStatus).toBe("MATHEMATICALLY_VERIFIED");
    expect(data.healedSource).toContain("(enforce (> amount 0.0)");
    expect(data.healedSource).toContain("(round (* amount 0.01) 12)");
  });

  it("POST /v1/prover/patch-proposal returns direct AST patch diffs", async () => {
    const source = `(module p GOV (defcap GOV () (enforce true)))`;
    const res = await fetch(`${baseUrl}/v1/prover/patch-proposal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source })
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.patchCount).toBeGreaterThan(0);
    expect(data.appliedPatches[0]).toContain("governance");
  });
});
