import { getEnv } from "../../env";

/**
 * Server-level MCP `instructions` (sent once in the `initialize` response, docs/architecture/05
 * §1). This is whole-server orientation for the agent — the per-tool/prompt/resource
 * descriptions (mcp-tool-descriptions skill) still carry the authoritative detail for each call.
 */
export function buildServerInstructions(): string {
  const appOrigin = getEnv().APP_ORIGIN;

  return `Artifact Hub is a platform for publishing and sharing AI-generated files (PDF, HTML, images, docx, Markdown, Mermaid diagrams) with revocable, owner-controlled access. This MCP server is the ONLY way to publish an artifact — there is no upload screen in the companion web app.

Publishing:
- Use "publish_artifact" to publish a new artifact and set its access policy (audience + expiry) in one call.
- Audience can be every authenticated user, specific users by email, or specific groups by name. Group names must match exactly — call "get_user_details" (the caller's own groups) or "list_groups" (every group in the org) to discover a real name rather than guessing. Publishing or sharing to a group the caller does not belong to is expected and supported.
- Large file bytes go via a presigned upload correlated by "bytesRef"; never inline large content into a tool argument.

Finding and reading artifacts:
- "list_artifacts" — the caller's own published artifacts ("My Artifacts").
- "list_shared_with_me" — artifacts other users or groups have shared with the caller, optionally within a recent window (e.g. "what's been shared with me in the last 24 hours?").
- "get_artifact" — small content read inline for reasoning. For the full file, read the "artifact://<id>" Resource instead; tool results never carry raw file bytes. Saving to disk is host-mediated — the human clicks save, this server never writes to disk itself.
- Every resource read is re-authorized against the artifact's current policy, so a revoked or expired artifact stops being readable immediately, even mid-conversation.

Collaborating:
- "comment_on_artifact" adds an attributable comment (shown to others with author name and date).
- The "summarise_artifact_reviews" prompt is user-invoked (e.g. a slash command) and asks the client's own model to summarise an artifact's comments — this server never calls an LLM itself.

Managing access (owner only):
- "set_access_policy" changes an owned artifact's audience/expiry — this is how access is revoked; there is no separate revoke action.
- "create_share_link" mints a locator link for others to open. The link is not a bearer token: opening it still re-checks the current access policy.

Companion web app:
- A companion single-page app at ${appOrigin} lets signed-in users browse "My Artifacts" and "Shared With Me", view/download artifacts, read and post comments, and — if they own the artifact — manage its access policy and share links, all from a browser. It has NO publish/upload screen; publishing only ever happens through this MCP server. Point users there when they want to browse or manage visually rather than conversationally.

Identity and scope:
- Every call here runs as the authenticated caller. The agent can do everything the signed-in human member can do (publish, view per policy, comment, manage its own artifacts' policy) but nothing more — no admin or user-management actions are exposed over MCP.`;
}
