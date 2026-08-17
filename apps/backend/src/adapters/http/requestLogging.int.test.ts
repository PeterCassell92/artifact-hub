import type { Express } from "express";
import request from "supertest";
import { startTestDatabase, type TestDatabase } from "../../test-support/testDatabase";

describe("request-correlation-id logging", () => {
  let db: TestDatabase;
  let app: Express;

  beforeAll(async () => {
    db = await startTestDatabase();
    const { createApp } = await import("../../app");
    app = createApp();
  }, 60_000);

  afterAll(async () => {
    await db.stop();
  });

  it("attaches an x-request-id header to every response", async () => {
    const res = await request(app).get("/healthz").expect(200);
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("echoes back a caller-supplied X-Request-Id unchanged", async () => {
    const res = await request(app).get("/healthz").set("X-Request-Id", "caller-supplied-id").expect(200);
    expect(res.headers["x-request-id"]).toBe("caller-supplied-id");
  });

  it("mints distinct ids for unrelated requests", async () => {
    const a = await request(app).get("/healthz").expect(200);
    const b = await request(app).get("/healthz").expect(200);
    expect(a.headers["x-request-id"]).not.toBe(b.headers["x-request-id"]);
  });
});
