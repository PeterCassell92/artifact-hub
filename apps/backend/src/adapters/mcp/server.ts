import type { Express } from "express";

/**
 * Mounts the MCP server on POST /mcp over Streamable HTTP (docs/architecture/05).
 *
 * Placeholder: the real wiring uses @modelcontextprotocol/sdk's
 * `StreamableHTTPServerTransport` + an `McpServer` registering the v1 tools
 * (publish_artifact, list_artifacts, list_shared_with_me, get_artifact,
 * comment_on_artifact, create_share_link, set_access_policy), the `artifact://<id>`
 * resource, and the `summarise_artifact_reviews` prompt.
 *
 * Auth (see 05 §2): validate the bearer token, require aud = MCP audience (R2), resolve
 * to an active local user (deny if absent, R1/R4). NO admin/user-management tools (R3).
 */
export function mountMcp(app: Express): void {
  app.all("/mcp", (_req, res) => {
    res.status(501).json({
      error: { code: "internal", message: "MCP endpoint not implemented yet" },
    });
  });
}
