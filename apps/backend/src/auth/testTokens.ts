import jwt, { type JwtPayload } from "jsonwebtoken";
import type { Env } from "../env";

/**
 * The shared "stub Auth0" test-token signer (docs/architecture/09 §3-4,
 * docs/development/bruno-mcp-token.md). Tokens minted here are signed with a symmetric secret the
 * RS validator trusts ONLY when NODE_ENV !== "production" (see ../auth/tokenValidation.ts) — used
 * by Jest and by POST /test/mcp-token for manual MCP exploration (Phases 1-3 of
 * dev-and-testing-phases-guide.md); never a substitute for real Auth0 JWKS validation, which local
 * human login always uses, and which is exercised end to end manually in Phase 4.
 */
export const TEST_JWT_ISSUER = "https://test-issuer.artifact-hub.local/";

export interface MintTestTokenOptions {
  /** The local user's idpSub — the claim the RS resolves back to a `users` row. */
  sub: string;
  audience: string;
  expiresInSeconds?: number;
}

function requireTestSigningSecret(env: Env): string {
  if (env.NODE_ENV === "production") {
    throw new Error("Test token signing must never run in production");
  }
  if (!env.TEST_JWT_SIGNING_SECRET) {
    throw new Error("TEST_JWT_SIGNING_SECRET is not set");
  }
  return env.TEST_JWT_SIGNING_SECRET;
}

/** The shared test-token helper (Jest suites call this directly; POST /test/mcp-token wraps it). */
export function mintTestToken(
  { sub, audience, expiresInSeconds = 3600 }: MintTestTokenOptions,
  env: Env,
): string {
  const secret = requireTestSigningSecret(env);
  return jwt.sign({}, secret, {
    subject: sub,
    audience,
    issuer: TEST_JWT_ISSUER,
    algorithm: "HS256",
    expiresIn: expiresInSeconds,
  });
}

/** Throws on any invalid token (bad signature, wrong audience/issuer, expired). */
export function verifyTestToken(token: string, audience: string, env: Env): JwtPayload {
  const secret = requireTestSigningSecret(env);
  return jwt.verify(token, secret, {
    algorithms: ["HS256"],
    audience,
    issuer: TEST_JWT_ISSUER,
  }) as JwtPayload;
}
