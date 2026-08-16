import express, { type Express } from "express";
import { prisma } from "./db";
import { getEnv } from "./env";
import { createApiRouter } from "./adapters/http/router";
import { createInvitationsPublicRouter } from "./adapters/http/routes/invitationsPublic";
import { mountMcp } from "./adapters/mcp/server";
import { createTestMcpTokenRouter } from "./adapters/http/routes/testMcpToken";

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

  // Unauthenticated invitation bootstrap (06 §6) — must be registered before the authenticated
  // /api router below so it's matched first; the invitee has no account/token yet.
  app.use("/api/invitations", createInvitationsPublicRouter());
  app.use("/api", createApiRouter());
  mountMcp(app);

  // Test-only token mint (docs/development/bruno-mcp-token.md) — never mounted in production.
  // Real local dev login still goes through Auth0 (docs/architecture/02 §1); this is for Jest and
  // manual MCP exploration only (docs/development/dev-and-testing-phases-guide.md §2).
  if (getEnv().NODE_ENV !== "production") {
    app.use("/test", createTestMcpTokenRouter());
  }

  return app;
}
