import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthenticatedViewer } from "../../auth/tokenValidation";
import { canManagePolicy, canView } from "../../core/authz";
import { computeExpiresAt } from "../../core/policy";
import {
  checkViewAndAudit,
  createArtifactPending,
  finalizeArtifact,
  findArtifactForDetail,
  listOwnedArtifacts,
  listSharedWithMe,
  resolveAudienceInput,
  toPolicy,
  toSummary,
  updateArtifactPolicy,
} from "../../database-service/artifacts";
import { createComment } from "../../database-service/comments";
import { recordAdminAuditLog } from "../../database-service/adminAuditLog";
import { createShareLink } from "../../database-service/shareLinks";
import { findUserWithGroupsById, toUserView } from "../../database-service/adminUsers";
import { listGroups, toGroupView } from "../../database-service/groups";
import { getObjectBuffer } from "../../storage/s3";
import { getEnv } from "../../env";
import { groupsTable, ownedArtifactsTable, sharedWithMeTable } from "./format";
import {
  CommentOnArtifactInput,
  CreateShareLinkInput,
  GetArtifactInput,
  GetUserDetailsInput,
  isValidPublishArtifactInput,
  ListArtifactsInput,
  ListGroupsInput,
  ListSharedWithMeInput,
  PublishArtifactInput,
  SetAccessPolicyInput,
} from "./schemas";
import { classifyArtifactContent, toolError, toolJson } from "./toolHelpers";

const PUBLISH_ARTIFACT_DESCRIPTION = `Publishes a new artifact from the calling agent's own work (a generated diagram, report, document, etc.) and sets who can see it. Use when the user asks to publish, share, or upload something the agent just produced. This is the ONLY way artifacts get created — there is no upload screen in the web app.

Do NOT use this to change an existing artifact's audience or expiry — use set_access_policy for that. publish_artifact never edits an artifact that already exists (no edit/delete in v1).

Two calls, one tool — file bytes never pass through this tool call. Call it WITHOUT bytesRef to start: supply title, fileName, contentType, audience, and expiry (plus optional description/kind/tags/sourceTool/format/language/metadata). The result includes uploadUrl, a short-lived presigned PUT URL. PUT the file's bytes to that URL yourself, outside MCP (e.g. curl -X PUT --data-binary @file "$uploadUrl"). Then call publish_artifact again with ONLY bytesRef (the value returned as bytesRef the first time) and, optionally, checksumSha256, to finish — this verifies the upload actually landed before the artifact is ready.

audience.type is one of public_authenticated (any signed-in user) | specific_users (requires audience.userEmails) | user_groups (requires audience.groupNames). expiry is one of 24h | 7d | 30d | never. groupNames must match a group's exact name — the caller does NOT need to belong to a group to publish to it. If you don't already have the exact name, call list_groups to see every group in the organization (or get_user_details for just the caller's own groups) rather than guessing.

Result is metadata-only JSON, never file bytes: on the start call, { artifactId, resourceUri, uploadUrl, bytesRef }; on the finish call, { artifactId, resourceUri }. Once published, read the file back via the artifact://<id> resource, never from this tool.

Example (start): publish_artifact({ title: "Q3 architecture diagram", fileName: "q3-arch.mmd", contentType: "text/x-mermaid", audience: { type: "user_groups", groupNames: ["engineering"] }, expiry: "30d" }). Example (finish): publish_artifact({ bytesRef: "<artifactId from the start call>" }).`;

const LIST_ARTIFACTS_DESCRIPTION = `Lists the artifacts the calling user has published — "My Artifacts". Use when the user asks what they've published, uploaded, or shared, or wants to manage/revoke their own artifacts.

Do NOT use this for artifacts other people shared with the caller — use list_shared_with_me for those; this tool only ever returns artifacts the caller owns.

Arguments: cursor (opaque pagination cursor from a previous call's nextCursor, optional), limit (1-100, default 20).

Result is metadata-only: a markdown table (id, title, filetype, createdAt, policy summary) plus the full { items, nextCursor } JSON for programmatic use.

Example: list_artifacts({ limit: 10 }).`;

const LIST_SHARED_WITH_ME_DESCRIPTION = `Lists artifacts that other users have shared with the calling user, optionally within a recent time window (sinceHours). Use when the user asks "what's been shared with me" or "shared with me in the last 24 hours".

Do NOT use this for the user's own uploads — use list_artifacts for those.

Arguments: sinceHours (only include artifacts published in the last N hours, optional), cursor (pagination, optional), limit (1-100, default 20).

Result is metadata-only: ALL matching rows come back in the JSON ({ items, nextCursor }), but only the first 10 are additionally rendered as a markdown table (#, Type, Published by, Published) for quick display — check the JSON if you need the rest.

Example: list_shared_with_me({ sinceHours: 24 }).`;

const GET_ARTIFACT_DESCRIPTION = `Fetches an artifact's content inline so the agent can read/quote/analyze it in this turn. Use for small artifacts you need to reason over right now.

Do NOT use this to deliver a file for the user to download or save — files are only ever obtained via the artifact://<id> Resource (read it directly). This tool is for in-context reasoning, not delivery, and refuses to inline large content.

Arguments: id (the artifact's uuid).

Result depends on size and type: a small image comes back as an image content block; small text or PDF content comes back as an embedded resource (text or base64 blob); anything larger comes back as a resource_link pointing at artifact://<id> instead of being truncated.

Example: get_artifact({ id: "3fa85f64-5717-4562-b3fc-2c963f66afa6" }).`;

const COMMENT_ON_ARTIFACT_DESCRIPTION = `Adds a comment to an artifact, attributed to the calling user. Use when the user asks the agent to leave feedback, a note, or a review comment on an artifact.

Requires the same access as viewing the artifact (commenting = viewing) — if the caller can't view it, they can't comment on it either; this is not a separate permission from get_artifact/the artifact:// resource.

Arguments: id (artifact uuid), body (comment text, 1-10,000 characters).

Result is metadata-only: { commentId, createdAt }.

Example: comment_on_artifact({ id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", body: "Looks good — ship it." }).`;

const CREATE_SHARE_LINK_DESCRIPTION = `Mints a shareable locator link (/s/<token>) for an artifact the caller owns. Use when the user asks for a link to send someone.

Owner-only — refuses for artifacts the caller doesn't own. Do NOT treat the link as granting access: it is a pure locator, not a bearer token — whoever opens it still needs to pass the artifact's current access policy (see set_access_policy) to see anything.

Arguments: id (artifact uuid, must be owned by the caller).

Result is metadata-only: { url }.

Example: create_share_link({ id: "3fa85f64-5717-4562-b3fc-2c963f66afa6" }).`;

const SET_ACCESS_POLICY_DESCRIPTION = `Changes who can access an artifact you own — its audience and/or expiry. Use for both granting broader access AND revoking/narrowing it; revocation is just replacing the policy, and it takes effect on the very next access everywhere (web UI, share links, and this MCP path alike).

Owner-only — refuses for artifacts the caller doesn't own. Do NOT use publish_artifact to edit an existing artifact's policy — this is the only tool that changes policy after publish.

Arguments: id (artifact uuid), audience ({ type: public_authenticated | specific_users | user_groups, userEmails? (required for specific_users), groupNames? (required for user_groups) }), expiry (24h | 7d | 30d | never). groupNames must match a group's exact name — the caller does NOT need to belong to a group to share with it. If you don't already have the exact name, call list_groups to see every group in the organization (or get_user_details for just the caller's own groups) rather than guessing.

Result is metadata-only: { ok, effectiveFrom }.

Example: set_access_policy({ id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", audience: { type: "specific_users", userEmails: ["reviewer@example.com"] }, expiry: "7d" }).`;

const GET_USER_DETAILS_DESCRIPTION = `Returns the calling user's own identity — email, display name, role, and the exact names of the groups they belong to. Use before publish_artifact or set_access_policy specifically when the user says something like "share with my team" and means one of THEIR OWN groups but hasn't given you the exact name.

Do NOT use this to look up any OTHER user's info — there is no such capability over MCP (no admin/user-management tools, R3); this only ever returns the calling user's own membership. Do NOT use this to find a group the caller ISN'T a member of — use list_groups for the full organization-wide list (you can publish/share to any group, not just your own).

Arguments: none.

Result is metadata-only: { email, name, role, groupNames }.

Example: get_user_details({}).`;

const LIST_GROUPS_DESCRIPTION = `Lists every group in the organization — name and description — regardless of whether the caller belongs to it. Use before publish_artifact or set_access_policy whenever the user wants to share with a group and you don't already have its exact name; audience.groupNames must match exactly, and guessing wastes a call. You can publish/share to any group, including ones the caller isn't a member of — that's expected, not an error.

Do NOT use this to see group MEMBERSHIP (who's in a group) — it returns group names/descriptions only, never member lists. Do NOT use this for the caller's own groups specifically if that's all you need — get_user_details is a smaller, equally valid answer for that narrower case, but list_groups always works too. This is a read-only lookup, not group management — there is no create/rename/membership-change capability over MCP (R3); those are /api/admin/groups-only, human-UI.

Arguments: none.

Result is metadata-only: { groups: [{ name, description }] }, plus a markdown table.

Example: list_groups({}).`;

/** Registers the v1 tool surface (docs/architecture/05 §4) on a per-request server, closing over
 * the already-authenticated `viewer` so every handler authorizes as that caller — no admin tools
 * (R3): invite/promote/demote/disable/group-management stay `/api/admin/*`-only. */
export function registerArtifactTools(server: McpServer, viewer: AuthenticatedViewer): void {
  server.registerTool(
    "publish_artifact",
    { title: "Publish artifact", description: PUBLISH_ARTIFACT_DESCRIPTION, inputSchema: PublishArtifactInput },
    async (args) => {
      if (!isValidPublishArtifactInput(args)) {
        return toolError(
          "Provide title, fileName, contentType, audience, and expiry to start a publish, or bytesRef (from a prior call) to finish one.",
        );
      }

      if (args.bytesRef) {
        const result = await finalizeArtifact(args.bytesRef, viewer.id, { checksumSha256: args.checksumSha256 });
        if (!result.ok) {
          switch (result.reason) {
            case "not_found":
              return toolError("No pending upload found for that bytesRef.");
            case "forbidden":
              return toolError("You do not own that pending upload.");
            case "object_missing":
              return toolError(
                "The file hasn't landed in storage yet — PUT it to the uploadUrl from the start call, then retry.",
              );
          }
        }
        return toolJson(
          { artifactId: result.artifact.id, resourceUri: `artifact://${result.artifact.id}` },
          `Published "${result.artifact.title}".`,
        );
      }

      const resolved = await resolveAudienceInput({
        audienceType: args.audience!.type,
        userEmails: args.audience!.userEmails,
        groupNames: args.audience!.groupNames,
      });
      if (!resolved.ok) return toolError(resolved.error);

      const { artifact, uploadUrl } = await createArtifactPending(viewer.id, {
        title: args.title!,
        description: args.description,
        fileName: args.fileName!,
        contentType: args.contentType!,
        kind: args.kind,
        tags: args.tags,
        sourceTool: args.sourceTool,
        format: args.format,
        language: args.language,
        metadata: args.metadata,
        audienceType: resolved.audienceType,
        allowedUserIds: resolved.allowedUserIds,
        allowedGroupIds: resolved.allowedGroupIds,
        expiresAt: computeExpiresAt(args.expiry!, new Date()),
      });

      return toolJson(
        { artifactId: artifact.id, resourceUri: `artifact://${artifact.id}`, uploadUrl, bytesRef: artifact.id },
        `Created pending artifact ${artifact.id}. PUT the file to uploadUrl, then call publish_artifact again with bytesRef="${artifact.id}" to finish.`,
      );
    },
  );

  server.registerTool(
    "list_artifacts",
    { title: "List my artifacts", description: LIST_ARTIFACTS_DESCRIPTION, inputSchema: ListArtifactsInput },
    async (args) => {
      const { items, nextCursor } = await listOwnedArtifacts(viewer.id, { limit: args.limit, cursor: args.cursor });
      const summaries = items.map((a) => toSummary(a, new Date()));
      return toolJson({ items: summaries, nextCursor }, ownedArtifactsTable(summaries));
    },
  );

  server.registerTool(
    "list_shared_with_me",
    {
      title: "List artifacts shared with me",
      description: LIST_SHARED_WITH_ME_DESCRIPTION,
      inputSchema: ListSharedWithMeInput,
    },
    async (args) => {
      const { items, nextCursor } = await listSharedWithMe(viewer, {
        sinceHours: args.sinceHours,
        cursor: args.cursor,
        limit: args.limit,
      });
      const summaries = items.map((a) => toSummary(a, new Date()));
      return toolJson({ items: summaries, nextCursor }, sharedWithMeTable(summaries));
    },
  );

  server.registerTool(
    "get_artifact",
    { title: "Get artifact content", description: GET_ARTIFACT_DESCRIPTION, inputSchema: GetArtifactInput },
    async (args) => {
      const artifact = await findArtifactForDetail(args.id);
      if (!artifact) return toolError("Artifact not found.");

      const decision = await checkViewAndAudit(viewer, artifact, "mcp", "view");
      if (!decision.allowed) return toolError(`Access denied (${decision.reason}).`);

      const sizeBytes = Number(artifact.sizeBytes);
      const presentation = classifyArtifactContent(artifact.contentType, sizeBytes);

      if (presentation === "pointer") {
        return {
          content: [
            {
              type: "resource_link" as const,
              uri: `artifact://${artifact.id}`,
              name: artifact.title,
              mimeType: artifact.contentType,
              description: `Too large to inline (${sizeBytes} bytes) — read this resource for the full file.`,
            },
          ],
        };
      }

      const { buffer } = await getObjectBuffer(artifact.storageKey);

      if (presentation === "image") {
        return {
          content: [{ type: "image" as const, data: buffer.toString("base64"), mimeType: artifact.contentType }],
        };
      }

      const resource =
        presentation === "embedded_text"
          ? { uri: `artifact://${artifact.id}`, mimeType: artifact.contentType, text: buffer.toString("utf8") }
          : { uri: `artifact://${artifact.id}`, mimeType: artifact.contentType, blob: buffer.toString("base64") };

      return { content: [{ type: "resource" as const, resource }] };
    },
  );

  server.registerTool(
    "comment_on_artifact",
    {
      title: "Comment on artifact",
      description: COMMENT_ON_ARTIFACT_DESCRIPTION,
      inputSchema: CommentOnArtifactInput,
    },
    async (args) => {
      const artifact = await findArtifactForDetail(args.id);
      if (!artifact) return toolError("Artifact not found.");

      const decision = canView(viewer, toPolicy(artifact), new Date());
      if (!decision.allowed) return toolError(`Access denied (${decision.reason}).`);

      const comment = await createComment(artifact.id, viewer.id, args.body);
      return toolJson({ commentId: comment.id, createdAt: comment.createdAt });
    },
  );

  server.registerTool(
    "create_share_link",
    { title: "Create share link", description: CREATE_SHARE_LINK_DESCRIPTION, inputSchema: CreateShareLinkInput },
    async (args) => {
      const artifact = await findArtifactForDetail(args.id);
      if (!artifact) return toolError("Artifact not found.");

      if (!canManagePolicy(viewer, toPolicy(artifact))) {
        return toolError("Only the owner can create a share link for this artifact.");
      }

      const link = await createShareLink(artifact.id, viewer.id);
      await recordAdminAuditLog({
        actorId: viewer.id,
        action: "share_link.create",
        targetType: "artifact",
        targetId: artifact.id,
        metadata: { shareLinkId: link.id },
      });

      const url = new URL(`/s/${link.token}`, getEnv().APP_ORIGIN).toString();
      return toolJson({ url });
    },
  );

  server.registerTool(
    "set_access_policy",
    { title: "Set access policy", description: SET_ACCESS_POLICY_DESCRIPTION, inputSchema: SetAccessPolicyInput },
    async (args) => {
      const artifact = await findArtifactForDetail(args.id);
      if (!artifact) return toolError("Artifact not found.");

      const before = toPolicy(artifact);
      if (!canManagePolicy(viewer, before)) {
        return toolError("Only the owner can change this artifact's access policy.");
      }

      const resolved = await resolveAudienceInput({
        audienceType: args.audience.type,
        userEmails: args.audience.userEmails,
        groupNames: args.audience.groupNames,
      });
      if (!resolved.ok) return toolError(resolved.error);

      const now = new Date();
      const expiresAt = computeExpiresAt(args.expiry, now);

      await updateArtifactPolicy(artifact.id, {
        audienceType: resolved.audienceType,
        expiresAt,
        allowedUserIds: resolved.allowedUserIds,
        allowedGroupIds: resolved.allowedGroupIds,
        updatedById: viewer.id,
      });

      await recordAdminAuditLog({
        actorId: viewer.id,
        action: "policy.update",
        targetType: "artifact",
        targetId: artifact.id,
        metadata: {
          before,
          after: {
            audienceType: resolved.audienceType,
            expiresAt,
            allowedUserIds: resolved.allowedUserIds,
            allowedGroupIds: resolved.allowedGroupIds,
          },
        },
      });

      return toolJson({ ok: true, effectiveFrom: now.toISOString() });
    },
  );

  server.registerTool(
    "get_user_details",
    { title: "Get user details", description: GET_USER_DETAILS_DESCRIPTION, inputSchema: GetUserDetailsInput },
    async () => {
      const user = await findUserWithGroupsById(viewer.id);
      if (!user) return toolError("User not found.");

      const { email, name, role, groupNames } = toUserView(user);
      return toolJson({ email, name, role, groupNames });
    },
  );

  server.registerTool(
    "list_groups",
    { title: "List groups", description: LIST_GROUPS_DESCRIPTION, inputSchema: ListGroupsInput },
    async () => {
      const groups = (await listGroups()).map(toGroupView).map(({ name, description }) => ({ name, description }));
      return toolJson({ groups }, groupsTable(groups));
    },
  );
}
