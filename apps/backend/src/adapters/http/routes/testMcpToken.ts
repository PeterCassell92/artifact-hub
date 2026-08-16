import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../../db";
import { getEnv } from "../../../env";
import { mintTestToken } from "../../../auth/testTokens";
import { sendError } from "../errors";

const BodySchema = z.object({ email: z.string().email() });

const EXPIRES_IN_SECONDS = 3600;

/**
 * POST /test/mcp-token — test-only token mint (docs/development/bruno-mcp-token.md). For Jest and
 * manual MCP exploration (Claude Code/MCP Inspector) only — real local dev login still goes
 * through Auth0 on the dev tenant. Mounted only when NODE_ENV !== "production" (see app.ts); also
 * 404s here as a belt-and-braces guard in case it's ever reached in prod some other way.
 *
 * Test-only provisioning shortcut (see docs/architecture/01 decision #39): since there is no SPA
 * login flow yet to complete a user's "first sign-in" (which would normally link idpSub and flip
 * invited -> active), minting a token for a known, non-disabled seeded user here backfills idpSub
 * (if unset) and activates the account — standing in for that first login. It never creates a new
 * `users` row (R1 still holds: only an already-provisioned user can get a token).
 */
export function createTestMcpTokenRouter(): Router {
  const router = Router();

  router.post("/mcp-token", async (req, res) => {
    const env = getEnv();
    if (env.NODE_ENV === "production") {
      res.status(404).end();
      return;
    }

    const providedSecret = req.header("x-test-token");
    if (!providedSecret || providedSecret !== env.TEST_MINT_SECRET) {
      sendError(res, 401, "unauthorized", "Missing/invalid X-Test-Token");
      return;
    }

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "bad_request", "email is required");
      return;
    }

    const email = parsed.data.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      sendError(res, 404, "not_found", "No user with that email");
      return;
    }
    if (user.status === "disabled") {
      sendError(res, 403, "forbidden", "User is disabled");
      return;
    }

    const idpSub = user.idpSub ?? `test|${user.id}`;
    await prisma.user.update({
      where: { id: user.id },
      data: { idpSub, status: "active" },
    });

    const accessToken = mintTestToken(
      { sub: idpSub, audience: env.AUTH0_MCP_AUDIENCE, expiresInSeconds: EXPIRES_IN_SECONDS },
      env,
    );

    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: EXPIRES_IN_SECONDS,
      aud: env.AUTH0_MCP_AUDIENCE,
    });
  });

  return router;
}
