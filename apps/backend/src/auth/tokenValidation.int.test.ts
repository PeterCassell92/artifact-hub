import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { startTestDatabase, type TestDatabase } from "../test-support/testDatabase";

/**
 * Exercises the shared auth middleware (requireAuth/requireAdmin) end to end against a real
 * Postgres, using a tiny purpose-built Express app rather than the real /api/* routes (those are
 * still 501 stubs until Phase 2 — see docs/development/implementation-plan.md). This directly
 * covers the Phase 1 acceptance bar: missing/invalid/wrong-audience/disabled/unknown-user all
 * correctly denied; a minted valid token for an active seeded user resolves and succeeds.
 */
describe("requireAuth / requireAdmin", () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let app: Express;
  let mintDevToken: typeof import("./devTokens").mintDevToken;
  let getEnv: typeof import("../env").getEnv;

  const API_AUDIENCE = "https://api.artifact-hub.test";
  const MCP_AUDIENCE = "https://mcp.artifact-hub.test";

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = db.prisma;

    ({ getEnv } = await import("../env"));
    ({ mintDevToken } = await import("./devTokens"));
    const { requireAuth, requireAdmin } = await import("./tokenValidation");
    const express = (await import("express")).default;

    app = express();
    app.get("/protected", requireAuth("api"), (req, res) => {
      res.json({ viewerId: req.viewer?.id, role: req.viewer?.role });
    });
    app.get("/admin-only", requireAuth("api"), requireAdmin(), (_req, res) => {
      res.json({ ok: true });
    });
  }, 60_000);

  afterAll(async () => {
    await db.stop();
  });

  async function makeUser(over: Partial<{
    email: string;
    idpSub: string;
    status: "invited" | "active" | "disabled";
    role: "member" | "admin";
  }> = {}) {
    return prisma.user.create({
      data: {
        email: over.email ?? `user-${Math.random()}@test.local`,
        idpSub: over.idpSub ?? `idp|${Math.random()}`,
        status: over.status ?? "active",
        role: over.role ?? "member",
      },
    });
  }

  it("401s with no token", async () => {
    await request(app).get("/protected").expect(401);
  });

  it("401s with a garbage token", async () => {
    await request(app).get("/protected").set("Authorization", "Bearer not-a-jwt").expect(401);
  });

  it("200s with a minted valid token for an active user", async () => {
    const user = await makeUser();
    const token = mintDevToken({ sub: user.idpSub as string, audience: API_AUDIENCE }, getEnv());

    const res = await request(app).get("/protected").set("Authorization", `Bearer ${token}`).expect(200);
    expect(res.body.viewerId).toBe(user.id);
  });

  it("403s for a token minted with the wrong audience", async () => {
    const user = await makeUser();
    const token = mintDevToken({ sub: user.idpSub as string, audience: MCP_AUDIENCE }, getEnv());

    // Cryptographically valid, just bound to a different resource (R2) — 403, not 401
    // (docs/architecture/06 §1 error contract: 401 unauthenticated, 403 denied).
    await request(app).get("/protected").set("Authorization", `Bearer ${token}`).expect(403);
  });

  it("401s for an expired token", async () => {
    const user = await makeUser();
    const token = mintDevToken(
      { sub: user.idpSub as string, audience: API_AUDIENCE, expiresInSeconds: -10 },
      getEnv(),
    );

    await request(app).get("/protected").set("Authorization", `Bearer ${token}`).expect(401);
  });

  it("403s for a disabled user", async () => {
    const user = await makeUser({ status: "disabled" });
    const token = mintDevToken({ sub: user.idpSub as string, audience: API_AUDIENCE }, getEnv());

    await request(app).get("/protected").set("Authorization", `Bearer ${token}`).expect(403);
  });

  it("403s for an unknown sub (no matching users row)", async () => {
    const token = mintDevToken({ sub: "idp|never-provisioned", audience: API_AUDIENCE }, getEnv());
    await request(app).get("/protected").set("Authorization", `Bearer ${token}`).expect(403);
  });

  it("403s a non-admin on an admin-guarded route", async () => {
    const user = await makeUser({ role: "member" });
    const token = mintDevToken({ sub: user.idpSub as string, audience: API_AUDIENCE }, getEnv());

    await request(app).get("/admin-only").set("Authorization", `Bearer ${token}`).expect(403);
  });

  it("200s an admin on an admin-guarded route", async () => {
    const user = await makeUser({ role: "admin" });
    const token = mintDevToken({ sub: user.idpSub as string, audience: API_AUDIENCE }, getEnv());

    await request(app).get("/admin-only").set("Authorization", `Bearer ${token}`).expect(200);
  });
});
