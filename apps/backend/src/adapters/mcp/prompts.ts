import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthenticatedViewer } from "../../auth/tokenValidation";
import { canView } from "../../core/authz";
import { findArtifactForDetail, toPolicy } from "../../database-service/artifacts";
import { listComments } from "../../database-service/comments";
import { SummariseArtifactReviewsArgs } from "./schemas";

const PROMPT_DESCRIPTION =
  "Summarise the reviews (comments) left on an artifact. The user invokes this themselves " +
  "(e.g. as a slash command in the client) — it is not called autonomously by the model. This " +
  "server performs no LLM call itself: it injects the artifact's comments as prompt content and " +
  "asks the CLIENT's own model to produce the summary.";

/** `summarise_artifact_reviews` (docs/architecture/05 §6) — LLM-free on the backend by design. */
export function registerReviewPrompt(server: McpServer, viewer: AuthenticatedViewer): void {
  server.registerPrompt(
    "summarise_artifact_reviews",
    {
      title: "Summarise artifact reviews",
      description: PROMPT_DESCRIPTION,
      argsSchema: SummariseArtifactReviewsArgs.shape,
    },
    async (args) => {
      const artifact = await findArtifactForDetail(args.artifactId);
      if (!artifact) throw new Error("Artifact not found.");

      const decision = canView(viewer, toPolicy(artifact), new Date());
      if (!decision.allowed) throw new Error(`Access denied (${decision.reason}).`);

      const comments = await listComments(artifact.id);
      const commentsText = comments.length
        ? comments.map((c) => `- ${c.authorName} (${c.createdAt}): ${c.body}`).join("\n")
        : "(No comments yet.)";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Summarise the key themes, sentiment, and action items from these reviews of "${artifact.title}":\n\n${commentsText}`,
            },
          },
        ],
      };
    },
  );
}
