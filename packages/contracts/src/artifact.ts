import { z } from "zod";
import { ArtifactKind, AudienceType, ExpiryOption } from "./enums";
import { paginated } from "./common";

/** The single access policy for an artifact (audience + expiry). */
export const AccessPolicyInput = z
  .object({
    audienceType: AudienceType,
    /** Required when audienceType === "specific_users". */
    userEmails: z.array(z.string().email()).optional(),
    /** Required when audienceType === "user_groups". */
    groupNames: z.array(z.string().min(1)).optional(),
    expiry: ExpiryOption,
  })
  .refine(
    (p) =>
      p.audienceType !== "specific_users" ||
      (p.userEmails?.length ?? 0) > 0,
    { message: "specific_users requires at least one userEmail" },
  )
  .refine(
    (p) => p.audienceType !== "user_groups" || (p.groupNames?.length ?? 0) > 0,
    { message: "user_groups requires at least one groupName" },
  );
export type AccessPolicyInput = z.infer<typeof AccessPolicyInput>;

/** Classification metadata captured at publish time (drives frontend filters). */
export const ArtifactMetadataInput = z.object({
  kind: ArtifactKind.optional(),
  tags: z.array(z.string().min(1)).optional(),
  sourceTool: z.string().optional(),
  format: z.string().optional(),
  language: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ArtifactMetadataInput = z.infer<typeof ArtifactMetadataInput>;

/** Row shape for lists (My Artifacts / Shared With Me / MCP tables). */
export const ArtifactSummary = z.object({
  id: z.string().uuid(),
  title: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  kind: ArtifactKind,
  sizeBytes: z.number().int().nonnegative(),
  publisherName: z.string().nullable(),
  publishedAt: z.string().datetime(),
  audienceType: AudienceType,
  expiresAt: z.string().datetime().nullable(),
  isExpired: z.boolean(),
  commentCount: z.number().int().nonnegative(),
});
export type ArtifactSummary = z.infer<typeof ArtifactSummary>;

/** GET /api/artifacts response envelope (docs/architecture/06 §1 pagination). */
export const ArtifactListResponse = paginated(ArtifactSummary);
export type ArtifactListResponse = z.infer<typeof ArtifactListResponse>;

/** GET /api/artifacts/:id response — summary fields plus what the detail view needs. */
export const ArtifactDetail = ArtifactSummary.extend({
  description: z.string().nullable(),
  ownerId: z.string().uuid(),
  canManagePolicy: z.boolean(),
});
export type ArtifactDetail = z.infer<typeof ArtifactDetail>;

/** Filters/search accepted by the list endpoints (see docs/frontend/02). */
export const ArtifactListQuery = z.object({
  scope: z.enum(["mine", "sharedWithMe"]).default("mine"),
  q: z.string().optional(),
  contentType: z.array(z.string()).optional(),
  kind: z.array(ArtifactKind).optional(),
  tags: z.array(z.string()).optional(),
  sourceTool: z.array(z.string()).optional(),
  // coerce: these schemas validate req.query too, where every value arrives as a string.
  sinceHours: z.coerce.number().int().positive().optional(),
  sort: z.enum(["published", "title", "lastAccessed", "size"]).default("published"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ArtifactListQuery = z.infer<typeof ArtifactListQuery>;

/**
 * What GET /api/artifacts actually supports today (implementation-plan.md Phase 2: "My
 * Artifacts — owner's own" only). `scope`/`q`/facets/`sort` land with the full search feature
 * (docs/frontend/02-filtering-and-search.md); reject them explicitly rather than silently
 * ignoring a filter the caller thinks was applied.
 */
export const MyArtifactsQuery = ArtifactListQuery.pick({
  scope: true,
  cursor: true,
  limit: true,
});
export type MyArtifactsQuery = z.infer<typeof MyArtifactsQuery>;
