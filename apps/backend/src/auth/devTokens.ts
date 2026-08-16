import jwt, { type JwtPayload } from "jsonwebtoken";
import type { Env } from "../env";

/**
 * The dev/test-only "stub Auth0" signer (docs/development/bruno-mcp-token.md,
 * 09 §3-4). Tokens minted here are signed with a symmetric secret the RS validator trusts
 * ONLY when NODE_ENV !== "production" (see ../auth/tokenValidation.ts) — never a substitute for
 * real Auth0 JWKS validation, which is exercised manually in Phase 4 (dev-and-testing-phases-guide
 * §2) and by ./auth0Tokens.ts in production.
 */
export const DEV_JWT_ISSUER = "https://dev-issuer.artifact-hub.local/";

export interface MintDevTokenOptions {
  /** The local user's idpSub — the claim the RS resolves back to a `users` row. */
  sub: string;
  audience: string;
  expiresInSeconds?: number;
}

function requireDevSigningSecret(env: Env): string {
  if (env.NODE_ENV === "production") {
    throw new Error("Dev/test token signing must never run in production");
  }
  if (!env.DEV_JWT_SIGNING_SECRET) {
    throw new Error("DEV_JWT_SIGNING_SECRET is not set");
  }
  return env.DEV_JWT_SIGNING_SECRET;
}

/** The shared test-token helper (Jest suites call this directly; POST /dev/mcp-token wraps it). */
export function mintDevToken(
  { sub, audience, expiresInSeconds = 3600 }: MintDevTokenOptions,
  env: Env,
): string {
  const secret = requireDevSigningSecret(env);
  return jwt.sign({}, secret, {
    subject: sub,
    audience,
    issuer: DEV_JWT_ISSUER,
    algorithm: "HS256",
    expiresIn: expiresInSeconds,
  });
}

/** Throws on any invalid token (bad signature, wrong audience/issuer, expired). */
export function verifyDevToken(token: string, audience: string, env: Env): JwtPayload {
  const secret = requireDevSigningSecret(env);
  return jwt.verify(token, secret, {
    algorithms: ["HS256"],
    audience,
    issuer: DEV_JWT_ISSUER,
  }) as JwtPayload;
}
