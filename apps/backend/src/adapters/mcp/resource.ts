import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthenticatedViewer } from "../../auth/tokenValidation";
import { checkViewAndAudit, findArtifactForDetail } from "../../database-service/artifacts";
import { getObjectBuffer } from "../../storage/s3";

const RESOURCE_DESCRIPTION =
  "The artifact's raw file content (blob + mimeType). Every read re-authorizes against the " +
  "artifact's CURRENT access policy and records an access-audit event (route=mcp, action=download) " +
  "— this is the only way an MCP agent obtains file bytes; files are never returned from a tool result.";

/**
 * `artifact://<id>` — the only byte path (docs/architecture/05 §5). Re-runs `canView` on every
 * read (never cached), so an owner narrowing a policy stops the agent path on the very next read,
 * same as revocation everywhere else.
 */
export function registerArtifactResource(server: McpServer, viewer: AuthenticatedViewer): void {
  const template = new ResourceTemplate("artifact://{id}", { list: undefined });

  server.registerResource(
    "artifact",
    template,
    { title: "Artifact file", description: RESOURCE_DESCRIPTION },
    async (uri, variables) => {
      const id = Array.isArray(variables.id) ? variables.id[0] : variables.id;
      if (!id) throw new Error("Missing artifact id in resource URI.");

      const artifact = await findArtifactForDetail(id);
      if (!artifact) throw new Error("Artifact not found.");

      const decision = await checkViewAndAudit(viewer, artifact, "mcp", "download");
      if (!decision.allowed) throw new Error(`Access denied (${decision.reason}).`);

      const { buffer } = await getObjectBuffer(artifact.storageKey);
      return {
        contents: [{ uri: uri.toString(), mimeType: artifact.contentType, blob: buffer.toString("base64") }],
      };
    },
  );
}
