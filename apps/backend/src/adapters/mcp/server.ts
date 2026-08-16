import type { Express } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireAuth, type AuthenticatedViewer } from "../../auth/tokenValidation";
import { registerArtifactTools } from "./tools";
import { registerArtifactResource } from "./resource";
import { registerPrompts } from "./prompts";
import { buildServerInstructions } from "./instructions";

/**
 * Builds a fresh, fully-registered server for one HTTP request (docs/architecture/05 §1:
 * stateless, so it scales behind fly-proxy across many machines — `sessionIdGenerator: undefined`
 * in mountMcp below). Every handler closes over `viewer`, so there's no need to thread auth
 * through the SDK's own `AuthInfo`/`extra` plumbing — the viewer was already resolved by
 * `requireAuth("mcp")` before this is called.
 */
export function createMcpServer(viewer: AuthenticatedViewer): McpServer {
  const server = new McpServer(
    { name: "artifact-hub", version: "1.0.0" },
    { instructions: buildServerInstructions() },
  );

  registerArtifactTools(server, viewer);
  registerArtifactResource(server, viewer);
  registerPrompts(server, viewer);

  return server;
}

/**
 * Mounts the MCP server on POST /mcp over Streamable HTTP (docs/architecture/05).
 *
 * Auth (05 §2): `requireAuth("mcp")` validates the bearer token — signature/issuer/expiry and
 * `aud` = the MCP resource (R2) — and resolves it to an active local user (deny if absent, R1/R4).
 * NO admin/user-management tools are registered (R3); `/api/admin/*` is structurally unreachable
 * with an MCP-audience token regardless.
 */
export function mountMcp(app: Express): void {
  app.post("/mcp", requireAuth("mcp"), async (req, res) => {
    const viewer = req.viewer!;
    const server = createMcpServer(viewer);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Stateless mode doesn't support the GET (server-push SSE) or DELETE (session teardown)
  // Streamable HTTP verbs — respond per spec rather than falling through to a generic 404.
  app.all("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });
}
