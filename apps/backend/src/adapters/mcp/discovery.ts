import type { Express, RequestHandler } from "express";
import { getEnv } from "../../env";
import { getMcpProtectedResourceMetadataUrl } from "../../auth/tokenValidation";

/**
 * RFC 9728 OAuth Protected Resource Metadata for `/mcp` (docs/architecture/02 §1.1 steps 1–4).
 * We are the Resource Server only — Auth0 is the real Authorization Server and serves its own
 * `/.well-known/openid-configuration` at its own domain, so we deliberately do NOT mirror
 * `/.well-known/oauth-authorization-server` on our own domain (unlike the MCP SDK's
 * `mcpAuthMetadataRouter`, which assumes you might want that); doing so would misrepresent us as
 * the AS. `authorization_servers` below just points clients at Auth0's issuer, which they're
 * expected to resolve themselves.
 */
function metadataResponder(metadata: Record<string, unknown>): RequestHandler {
  return (req, res) => {
    if (req.method !== "GET" && req.method !== "OPTIONS") {
      res.status(405).end();
      return;
    }
    // Public, read-only metadata (RFC 9728) — permissive CORS so browser-based MCP clients can
    // fetch it cross-origin, same as the reference SDK handler this deliberately doesn't reuse.
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.status(200).json(metadata);
  };
}

/** Mounts the PRM discovery endpoint(s) — call alongside mountMcp(app). */
export function mountOAuthDiscovery(app: Express): void {
  const env = getEnv();

  const metadata = {
    resource: env.AUTH0_MCP_AUDIENCE,
    authorization_servers: [`https://${env.AUTH0_DOMAIN}/`],
    resource_name: "Artifact Hub MCP",
  };

  const handler = metadataResponder(metadata);
  const canonicalPath = new URL(getMcpProtectedResourceMetadataUrl(env)).pathname;

  app.all(canonicalPath, handler);
  // Defensive alias: some clients/versions probe the bare well-known path before trying the
  // path-specific one RFC 9728 §3.1 actually specifies for a non-root resource.
  app.all("/.well-known/oauth-protected-resource", handler);
}
