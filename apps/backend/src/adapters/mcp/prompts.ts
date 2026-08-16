import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthenticatedViewer } from "../../auth/tokenValidation";
import * as summariseArtifactReviews from "./prompts/summarise-artifact-reviews";

/**
 * Registers the v1 prompt surface (docs/architecture/05 §6). This file only imports and
 * registers prompts — each prompt's own text/logic lives in its own file under prompts/.
 */
export function registerPrompts(server: McpServer, viewer: AuthenticatedViewer): void {
  server.registerPrompt(
    summariseArtifactReviews.NAME,
    {
      title: summariseArtifactReviews.TITLE,
      description: summariseArtifactReviews.DESCRIPTION,
      argsSchema: summariseArtifactReviews.ARGS_SCHEMA,
    },
    (args) => summariseArtifactReviews.handle(viewer, args),
  );
}
