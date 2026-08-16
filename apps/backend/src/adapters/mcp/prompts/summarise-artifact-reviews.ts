import type { z } from "zod";
import type { AuthenticatedViewer } from "../../../auth/tokenValidation";
import { canView } from "../../../core/authz";
import { findArtifactForDetail, toPolicy } from "../../../database-service/artifacts";
import { listComments } from "../../../database-service/comments";
import { SummariseArtifactReviewsArgs } from "../schemas";

export const NAME = "summarise_artifact_reviews";

export const TITLE = "Summarise artifact reviews";

export const DESCRIPTION =
  "Summarise the reviews (comments) left on an artifact. The user invokes this themselves " +
  "(e.g. as a slash command in the client) — it is not called autonomously by the model. This " +
  "server performs no LLM call itself: it injects the artifact's comments as prompt content and " +
  "asks the CLIENT's own model to produce the summary.";

export const ARGS_SCHEMA = SummariseArtifactReviewsArgs.shape;

type Args = z.infer<typeof SummariseArtifactReviewsArgs>;

/** `summarise_artifact_reviews` (docs/architecture/05 §6) — LLM-free on the backend by design;
 * this only ever assembles the prompt text, never calls a model itself. */
export async function handle(viewer: AuthenticatedViewer, args: Args) {
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
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Summarise the key themes, sentiment, and action items from these reviews of "${artifact.title}":\n\n${commentsText}`,
        },
      },
    ],
  };
}
