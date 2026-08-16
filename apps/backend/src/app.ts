import express, { type Express } from "express";
import { prisma } from "./db";
import { getEnv } from "./env";
import { createApiRouter } from "./adapters/http/router";
import { mountMcp } from "./adapters/mcp/server";
import { createDevMcpTokenRouter } from "./adapters/http/routes/devMcpToken";

/** Builds the Express app (API + MCP) — exported so integration tests can drive it. */
export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Liveness: process is up.
  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // Readiness: DB reachable (Fly health check; docs/architecture/06 §7).
  app.get("/readyz", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use("/api", createApiRouter());
  mountMcp(app);

  // Dev-only token mint (docs/development/bruno-mcp-token.md) — never mounted in production.
  if (getEnv().NODE_ENV !== "production") {
    app.use("/dev", createDevMcpTokenRouter());
  }

  return app;
}
