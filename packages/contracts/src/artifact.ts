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
  ownerId: z.string().uuid(),
  title: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  kind: ArtifactKind,
  /** Format detail, e.g. "mermaid"/"markdown"/"png" (docs/models/artifact.md §2) — falls back to
   * `kind` for display when unset (e.g. MCP list tables, docs/architecture/05 §4). */
  format: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  publisherName: z.string().nullable(),
  publishedAt: z.string().datetime(),
  audienceType: AudienceType,
  expiresAt: z.string().datetime().nullable(),
  isExpired: z.boolean(),
  /** Owner-initiated instant cutoff (03 §1a) — distinct from `isExpired`'s natural bucketed
   * expiry. Saving a new policy always clears this back to false. */
  revoked: z.boolean(),
  commentCount: z.number().int().nonnegative(),
});
export type ArtifactSummary = z.infer<typeof ArtifactSummary>;

/** GET /api/artifacts response envelope (docs/architecture/06 §1 pagination). */
export const ArtifactListResponse = paginated(ArtifactSummary);
export type ArtifactListResponse = z.infer<typeof ArtifactListResponse>;

/** GET /api/artifacts/:id response — summary fields plus what the detail view needs. */
export const ArtifactDetail = ArtifactSummary.extend({
  description: z.string().nullable(),
  canManagePolicy: z.boolean(),
});
export type ArtifactDetail = z.infer<typeof ArtifactDetail>;

/**
 * A `?flag=true`/`?flag=false` query param. NOT `z.coerce.boolean()` — that coerces via JS's
 * `Boolean(value)`, so the *string* `"false"` (any non-empty string) comes out `true`.
 */
function booleanParam() {
  return z.preprocess((v) => (typeof v === "string" ? v === "true" : v), z.boolean()).optional();
}

/**
 * A multi-value query param that tolerates the two shapes it can actually arrive in: a single
 * value (`?tags=a`, parsed by Express as a bare string) or a real array (`?tags=a&tags=b`, parsed
 * as `string[]`). Also accepts one comma-separated value (`?tags=a,b`) since that's what a plain
 * `URLSearchParams`-based client (e.g. RTK Query's default param serialization) produces for an
 * array value — there's no bracket/repeated-key convention to rely on client-side.
 */
function csvParam<T extends z.ZodTypeAny>(item: T) {
  return z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(",")))
    .pipe(z.array(item))
    .optional();
}

/**
 * Filters/search/sort accepted by `GET /api/artifacts` (docs/frontend/02-filtering-and-search.md,
 * implementation-plan.md Phase 7). `audienceType`/`isExpired` only apply to `scope=mine` (a
 * non-owner can never see another audience type's worth of "my" artifacts, and `sharedWithMe`
 * never includes expired artifacts — `canView` already excludes them for non-owners);
 * `publisherId` only applies to `scope=sharedWithMe`. The backend ignores filters that don't
 * apply to the current scope rather than rejecting them, so one control set works for both pages.
 */
export const ArtifactListQuery = z.object({
  scope: z.enum(["mine", "sharedWithMe"]).default("mine"),
  q: z.string().optional(),
  contentType: csvParam(z.string()),
  kind: csvParam(ArtifactKind),
  tags: csvParam(z.string()),
  sourceTool: csvParam(z.string()),
  audienceType: csvParam(AudienceType),
  isExpired: booleanParam(),
  publisherId: csvParam(z.string().uuid()),
  // coerce: these schemas validate req.query too, where every value arrives as a string.
  sinceHours: z.coerce.number().int().positive().optional(),
  sort: z.enum(["published", "title", "lastAccessed", "size"]).default("published"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ArtifactListQuery = z.infer<typeof ArtifactListQuery>;

/** Distinct facet values the caller can actually filter by, scoped to what they can see
 * (`GET /api/artifacts/facets?scope=`) — populates the multi-select controls with real values
 * instead of a guessed/fixed catalogue (contentType and tags are free-form). */
export const ArtifactFacetOptions = z.object({
  contentTypes: z.array(z.string()),
  tags: z.array(z.string()),
  sourceTools: z.array(z.string()),
  /** Only populated for scope=sharedWithMe — who has shared something with the caller. */
  publishers: z.array(z.object({ id: z.string().uuid(), name: z.string().nullable() })),
});
export type ArtifactFacetOptions = z.infer<typeof ArtifactFacetOptions>;

/** GET /api/artifacts/:id/download JSON-negotiated response (Accept: application/json). */
export const DownloadUrlResponse = z.object({ url: z.string().url() });
export type DownloadUrlResponse = z.infer<typeof DownloadUrlResponse>;
