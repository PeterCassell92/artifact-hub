import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { JwtPayload } from "jsonwebtoken";
import jwt from "jsonwebtoken";
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { ApiErrorCode, Role } from "contracts";
import { prisma } from "../db";
import { getEnv, type Env } from "../env";
import type { Viewer } from "../core/authz";
import { sendError } from "../adapters/http/errors";
import { TEST_JWT_ISSUER, verifyTestToken } from "./testTokens";
import { verifyAuth0Token } from "./auth0Tokens";

export interface AuthenticatedViewer extends Viewer {
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      viewer?: AuthenticatedViewer;
    }
  }
}

export type Audience = "api" | "mcp";

function audienceFor(audience: Audience, env: Env): string {
  return audience === "api" ? env.AUTH0_API_AUDIENCE : env.AUTH0_MCP_AUDIENCE;
}

/**
 * The RFC 9728 Protected Resource Metadata URL for `/mcp` (docs/architecture/02 §1.1 step 2) —
 * shared by the discovery endpoint itself (adapters/mcp/discovery.ts) and the `WWW-Authenticate`
 * header below, so the two can't drift apart. Path convention (`.well-known/oauth-protected-resource`
 * + the resource's own path, since `/mcp` isn't root) reuses the MCP SDK's own RFC 9728 helper.
 */
export function getMcpProtectedResourceMetadataUrl(env: Env): string {
  return getOAuthProtectedResourceMetadataUrl(new URL(env.AUTH0_MCP_AUDIENCE));
}

/**
 * Dispatches to the dev/test signer (docs/development/bruno-mcp-token.md) when the token's
 * (unverified) issuer claim is ours and we're not in production, else to real Auth0 JWKS
 * validation (docs/architecture/02 §1). This keeps automated tests off the network entirely while
 * still validating real Auth0 tokens end-to-end for actual local dev usage (Role A human login).
 */
async function verifyToken(token: string, audience: Audience, env: Env): Promise<JwtPayload> {
  const expectedAudience = audienceFor(audience, env);
  const decoded = jwt.decode(token, { json: true });

  if (env.NODE_ENV !== "production" && decoded?.iss === TEST_JWT_ISSUER) {
    return verifyTestToken(token, expectedAudience, env);
  }
  if (!decoded) {
    throw new Error("Malformed token");
  }
  return verifyAuth0Token(token, expectedAudience, env);
}

/**
 * Shared token-validation middleware (docs/architecture/02 §1, implementation-plan Phase 1).
 * Validates signature/issuer/audience/expiry, then resolves `sub` -> an active local `users` row
 * and attaches it as `req.viewer`. Never auto-provisions (R1): a token with no matching row, or a
 * row with status != "active", is denied.
 */
export function requireAuth(audience: Audience): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const env = getEnv();

    // Every denial on the MCP audience carries WWW-Authenticate pointing at our Protected
    // Resource Metadata (docs/architecture/02 §1.1 step 2 — RFC 9728 discovery), so a client that
    // shows up with no (valid) token can find its way to the real Auth0 flow. `/api/*` has no such
    // discovery step — MCP-only.
    const deny = (status: number, code: ApiErrorCode, message: string, details?: Record<string, unknown>) => {
      if (audience === "mcp") {
        res.set("WWW-Authenticate", `Bearer resource_metadata="${getMcpProtectedResourceMetadataUrl(env)}"`);
      }
      sendError(res, status, code, message, details);
    };

    const header = req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
    if (!token) {
      deny(401, "unauthorized", "Missing bearer token");
      return;
    }

    let payload: JwtPayload;
    try {
      payload = await verifyToken(token, audience, env);
    } catch (err) {
      // A token that is cryptographically valid but bound to a different resource (R2) is a
      // distinct case from "not authenticated at all" — 403, per 06 §1 / implementation-plan
      // Phase 1 ("401 unauthenticated, 403 denied"). jsonwebtoken's audience-mismatch message is
      // stable across versions; see node_modules/jsonwebtoken/verify.js.
      if (err instanceof jwt.JsonWebTokenError && err.message.startsWith("jwt audience invalid")) {
        deny(403, "forbidden", "Token not valid for this resource");
      } else {
        deny(401, "unauthorized", "Invalid or expired token");
      }
      return;
    }

    const sub = payload.sub;
    if (!sub) {
      deny(401, "unauthorized", "Token missing subject");
      return;
    }

    const user = await prisma.user.findUnique({
      where: { idpSub: sub },
      include: { memberships: true },
    });

    if (!user || user.status !== "active") {
      deny(403, "forbidden", "No active account for this identity");
      return;
    }

    req.viewer = {
      id: user.id,
      status: user.status,
      role: user.role,
      groupIds: user.memberships.map((m) => m.groupId),
    };
    next();
  };
}

/** `/api/admin/*` guard (docs/architecture/02 §7, R3) — mount AFTER requireAuth("api"). */
export function requireAdmin(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.viewer?.role !== "admin") {
      sendError(res, 403, "forbidden", "Admin role required");
      return;
    }
    next();
  };
}
