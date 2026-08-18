import { z } from "zod";
import { ArtifactRelationshipInput, ArtifactRelationshipLinkResult } from "./collaboration";
import { ArtifactKind, AudienceType, EnrichmentSource, ExpiryOption } from "./enums";
import { paginated } from "./common";

/** Audience + expiry, unrefined — the shared base for AccessPolicyInput (policy edits) and
 * CreateArtifactInput (publish), so the "audience requires emails/groups" rule can't drift
 * between them. */
const AudiencePolicyFields = z.object({
  audienceType: AudienceType,
  /** Required when audienceType === "specific_users". */
  userEmails: z.array(z.string().email()).optional(),
  /** Required when audienceType === "user_groups". */
  groupNames: z.array(z.string().min(1)).optional(),
  expiry: ExpiryOption,
});

/** Shared shape both audience-validation rules below check against — plain predicates, not a
 * generic schema-transforming helper, so `.refine()`'s output type stays exact per call site
 * instead of widening through a generic `ZodObject<any, ...>` constraint. */
interface AudiencePolicyShape {
  audienceType: AudienceType;
  userEmails?: string[];
  groupNames?: string[];
}
const specificUsersHaveEmails = (p: AudiencePolicyShape) =>
  p.audienceType !== "specific_users" || (p.userEmails?.length ?? 0) > 0;
const userGroupsHaveGroups = (p: AudiencePolicyShape) =>
  p.audienceType !== "user_groups" || (p.groupNames?.length ?? 0) > 0;

/** The single access policy for an artifact (audience + expiry). */
export const AccessPolicyInput = AudiencePolicyFields.refine(specificUsersHaveEmails, {
  message: "specific_users requires at least one userEmail",
}).refine(userGroupsHaveGroups, { message: "user_groups requires at least one groupName" });
export type AccessPolicyInput = z.infer<typeof AccessPolicyInput>;

/** Upload cap, enforced in `finalizeArtifact` (post-`HeadObject`) and pre-checked client-side by
 * the SPA before it starts uploading — a fixed, low-effort guardrail against storage costs
 * ballooning, not a security control (demo has trusted publishers only). */
export const MAX_ARTIFACT_SIZE_BYTES = 500 * 1024 * 1024;

/** Classification metadata captured at publish time (drives frontend filters). */
export const ArtifactMetadataInput = z.object({
  kind: ArtifactKind.optional(),
  tags: z.array(z.string().min(1)).optional(),
  sourceTool: z.string().optional(),
  language: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ArtifactMetadataInput = z.infer<typeof ArtifactMetadataInput>;

/** POST /api/artifacts body — creates a pending artifact + policy, backing both the MCP
 * `publish_artifact` tool's REST-equivalent and the SPA's "Publish New Artifact" modal.
 *
 * Deliberately does NOT apply the specificUsersHaveEmails/userGroupsHaveGroups rules that
 * AccessPolicyInput enforces: those rules exist to stop an *owner editing a live policy* from
 * saving a nonsensical "specific people, but I picked nobody" state. At create time,
 * `audienceType: "specific_users", userEmails: []` is the SPA's intentional safe default — a
 * private, owner-only artifact — not a mistake to reject. Matches the MCP `publish_artifact`
 * tool's own schema (schemas.ts `PublishArtifactInput`), which never applied these rules either. */
export const CreateArtifactInput = AudiencePolicyFields.extend({
  title: z.string().min(1),
  description: z.string().optional(),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  /** Links to already-existing artifacts, created right after this one — same optional
   * enrichment as the MCP `publish_artifact` tool's `relationships` (05 §4). A bad `toId` is
   * reported per-entry in the response's `relationshipResults`, never fails the publish. */
  relationships: z.array(ArtifactRelationshipInput).optional(),
}).merge(ArtifactMetadataInput);
export type CreateArtifactInput = z.infer<typeof CreateArtifactInput>;

/** POST /api/artifacts response — a short-lived presigned PUT for the file bytes. */
export const CreateArtifactResponse = z.object({
  artifactId: z.string().uuid(),
  uploadUrl: z.string().url(),
  relationshipResults: z.array(ArtifactRelationshipLinkResult).optional(),
});
export type CreateArtifactResponse = z.infer<typeof CreateArtifactResponse>;

/** POST /api/artifacts/:id/finalize body — confirms the presigned-PUT landed. */
export const FinalizeArtifactInput = z.object({
  checksumSha256: z.string().optional(),
});
export type FinalizeArtifactInput = z.infer<typeof FinalizeArtifactInput>;

/** Row shape for lists (My Artifacts / Shared With Me / MCP tables). */
export const ArtifactSummary = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  title: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  kind: ArtifactKind,
  sizeBytes: z.number().int().nonnegative(),
  publisherName: z.string(),
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

/** A tag as shown on the detail page — `source`/`confidence` distinguish human-entered tags
 * from ones the enrichment job proposed (docs/architecture/01 decision #46). */
export const ArtifactTagView = z.object({
  name: z.string(),
  source: EnrichmentSource,
  confidence: z.number().min(0).max(1).nullable(),
});
export type ArtifactTagView = z.infer<typeof ArtifactTagView>;

/** GET /api/artifacts/:id response — summary fields plus what the detail view needs. */
export const ArtifactDetail = ArtifactSummary.extend({
  description: z.string().nullable(),
  canManagePolicy: z.boolean(),
  /** Owner or admin — gates whether the SPA shows the Access History panel and whether
   * `GET .../access-events` will succeed for this viewer. */
  canViewAccessEvents: z.boolean(),
  tags: z.array(ArtifactTagView),
  /** AI-generated enrichment output (docs/architecture/01 decision #46) — null/empty until the
   * first enrichment run completes. See `GET .../enrichment` for the job history that produced
   * these. */
  aiSummary: z.string().nullable(),
  aiTopics: z.array(z.string()),
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
