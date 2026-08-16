import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../../db";
import { getEnv } from "../../../env";
import { mintDevToken } from "../../../auth/devTokens";

const BodySchema = z.object({ email: z.string().email() });

const EXPIRES_IN_SECONDS = 3600;

/**
 * POST /dev/mcp-token — dev-only token mint (docs/development/bruno-mcp-token.md). Mounted only
 * when NODE_ENV !== "production" (see app.ts); also 404s here as a belt-and-braces guard in case
 * it's ever reached in prod some other way.
 *
 * Dev-only provisioning shortcut (see docs/architecture/01 decision #39): since there is no SPA
 * login flow yet to complete a user's "first sign-in" (which would normally link idpSub and flip
 * invited -> active), minting a token for a known, non-disabled seeded user here backfills idpSub
 * (if unset) and activates the account — the dev-tool analogue of that first login. It never
 * creates a new `users` row (R1 still holds: only an already-provisioned user can get a token).
 */
export function createDevMcpTokenRouter(): Router {
  const router = Router();

  router.post("/mcp-token", async (req, res) => {
    const env = getEnv();
    if (env.NODE_ENV === "production") {
      res.status(404).end();
      return;
    }

    const providedSecret = req.header("x-dev-token");
    if (!providedSecret || providedSecret !== env.DEV_MINT_SECRET) {
      res.status(401).json({ error: { code: "unauthorized", message: "Missing/invalid X-Dev-Token" } });
      return;
    }

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "bad_request", message: "email is required" } });
      return;
    }

    const email = parsed.data.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(404).json({ error: { code: "not_found", message: "No user with that email" } });
      return;
    }
    if (user.status === "disabled") {
      res.status(403).json({ error: { code: "forbidden", message: "User is disabled" } });
      return;
    }

    const idpSub = user.idpSub ?? `dev|${user.id}`;
    await prisma.user.update({
      where: { id: user.id },
      data: { idpSub, status: "active" },
    });

    const accessToken = mintDevToken(
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
