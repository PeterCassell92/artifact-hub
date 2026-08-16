import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { jest } from "@jest/globals";
import { startTestDatabase, type TestDatabase } from "../../../test-support/testDatabase";

describe("POST /dev/mcp-token", () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let app: Express;
  let getEnv: typeof import("../../../env").getEnv;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = db.prisma;

    ({ getEnv } = await import("../../../env"));
    const { createApp } = await import("../../../app");
    app = createApp();
  }, 60_000);

  afterAll(async () => {
    await db.stop();
  });

  it("mints a token for a seeded, non-disabled user and activates + links idpSub", async () => {
    const user = await prisma.user.create({
      data: { email: "invited-admin@test.local", role: "admin", status: "invited" },
    });

    const res = await request(app)
      .post("/dev/mcp-token")
      .set("X-Dev-Token", getEnv().DEV_MINT_SECRET as string)
      .send({ email: user.email })
      .expect(200);

    expect(res.body).toMatchObject({
      token_type: "Bearer",
      expires_in: 3600,
      aud: getEnv().AUTH0_MCP_AUDIENCE,
    });
    expect(typeof res.body.access_token).toBe("string");

    const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(reloaded.status).toBe("active");
    expect(reloaded.idpSub).toBeTruthy();
  });

  it("401s with a missing/wrong X-Dev-Token", async () => {
    await request(app).post("/dev/mcp-token").send({ email: "nobody@test.local" }).expect(401);
    await request(app)
      .post("/dev/mcp-token")
      .set("X-Dev-Token", "wrong-secret")
      .send({ email: "nobody@test.local" })
      .expect(401);
  });

  it("404s for an email with no users row", async () => {
    await request(app)
      .post("/dev/mcp-token")
      .set("X-Dev-Token", getEnv().DEV_MINT_SECRET as string)
      .send({ email: "never-seeded@test.local" })
      .expect(404);
  });

  it("403s for a disabled user", async () => {
    const user = await prisma.user.create({
      data: { email: "disabled-user@test.local", status: "disabled" },
    });

    await request(app)
      .post("/dev/mcp-token")
      .set("X-Dev-Token", getEnv().DEV_MINT_SECRET as string)
      .send({ email: user.email })
      .expect(403);
  });

  it("is absent (404) when NODE_ENV=production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    // getEnv() caches per-module-instance; force a fresh read by re-importing under production.
    jest.resetModules();
    try {
      const { createApp: createProdApp } = await import("../../../app");
      const prodApp = createProdApp();
      await request(prodApp)
        .post("/dev/mcp-token")
        .send({ email: "whoever@test.local" })
        .expect(404);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      jest.resetModules();
    }
  });
});
