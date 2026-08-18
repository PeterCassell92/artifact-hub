import { z } from "zod";
import { AccessEventListQuery, ArtifactKind, ArtifactRelationshipInput, AudienceType, CreateCommentInput, ExpiryOption } from "contracts";

/** Nested `{ type, userEmails?, groupNames? }` shape named in docs/architecture/05 §4 — used by
 * both `publish_artifact` and `set_access_policy` (the two tools that set an artifact's audience). */
export const McpAudienceInput = z
  .object({
    type: AudienceType,
    userEmails: z.array(z.string().email()).optional(),
    groupNames: z.array(z.string().min(1)).optional(),
  })
  .refine((a) => a.type !== "specific_users" || (a.userEmails?.length ?? 0) > 0, {
    message: "audience.type = specific_users requires at least one userEmail",
  })
  .refine((a) => a.type !== "user_groups" || (a.groupNames?.length ?? 0) > 0, {
    message: "audience.type = user_groups requires at least one groupName",
  });

/**
 * Two calls, one tool (docs/architecture/01 decision #44): omit `bytesRef` to start a publish
 * (returns a presigned upload URL); pass it back to finish. Either the "start" fields or
 * `bytesRef` must be present — enforced in the tool handler, NOT via `.refine()` here: a
 * `.refine()`-wrapped top-level tool `inputSchema` doesn't unwrap to real JSON Schema properties
 * in `tools/list` (verified against the MCP SDK — it advertises an empty `{}` schema), which
 * would hide every field from agents inspecting the tool. Nested refined objects (e.g.
 * McpAudienceInput below) are unaffected; only the outermost tool schema needs to stay a plain
 * ZodObject.
 */
export const PublishArtifactInput = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  fileName: z.string().min(1).optional(),
  contentType: z.string().min(1).optional(),
  kind: ArtifactKind.optional(),
  tags: z.array(z.string().min(1)).optional(),
  sourceTool: z.string().optional(),
  language: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** Absolute local path of the file on the publisher's machine. Never stored — only echoed
   * into webUploadUrl's hash fragment so the completion page can show the user a copyable
   * path for the OS file picker (a browser can't pre-select a file itself). */
  filePath: z.string().min(1).optional(),
  audience: McpAudienceInput.optional(),
  expiry: ExpiryOption.optional(),
  /** Optional links to already-existing artifacts, created right after this one — see
   * link_artifacts for the post-hoc equivalent. Only honoured on the start call. */
  relationships: z.array(ArtifactRelationshipInput).optional(),
  bytesRef: z.string().uuid().optional(),
  checksumSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, "checksumSha256 must be a 64-character hex sha256 digest")
    .optional(),
});

/** The cross-field rule `.refine()` would otherwise have enforced — see PublishArtifactInput's comment. */
export function isValidPublishArtifactInput(input: z.infer<typeof PublishArtifactInput>): boolean {
  return Boolean(input.bytesRef) || Boolean(input.title && input.fileName && input.contentType && input.audience && input.expiry);
}

export const ListArtifactsInput = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

export const ListSharedWithMeInput = z.object({
  sinceHours: z.number().int().positive().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

export const GetArtifactInput = z.object({ id: z.string().uuid() });

export const CommentOnArtifactInput = CreateCommentInput.extend({ id: z.string().uuid() });

export const ListCommentsInput = z.object({ id: z.string().uuid() });

export const CreateShareLinkInput = z.object({ id: z.string().uuid() });

export const RevokeAccessInput = z.object({ id: z.string().uuid() });

export const SetAccessPolicyInput = z.object({
  id: z.string().uuid(),
  audience: McpAudienceInput,
  expiry: ExpiryOption,
});

export const LinkArtifactsInput = ArtifactRelationshipInput.extend({ fromId: z.string().uuid() });

export const ListArtifactRelationshipsInput = z.object({ id: z.string().uuid() });

/** Owner-only (unlike ListArtifactRelationshipsInput/ListCommentsInput, which only need view
 * access) — see get_access_history's tool description for why. */
export const ListAccessHistoryInput = AccessEventListQuery.extend({ id: z.string().uuid() });

/** Corpus-wide, optionally type-filtered — see `ListRelationshipsInput`'s doc comment in
 * contracts for how this differs from `ListArtifactRelationshipsInput` above. */
export { ListRelationshipsInput } from "contracts";

export const UnlinkArtifactsInput = z.object({ relationshipId: z.string().uuid() });

export const SummariseArtifactReviewsArgs = z.object({ artifactId: z.string() });

export const GetUserDetailsInput = z.object({});

export const ListGroupsInput = z.object({});

export const GetEnrichmentStatusInput = z.object({ id: z.string().uuid() });
