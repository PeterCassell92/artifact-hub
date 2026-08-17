import { z } from "zod";
import { ArtifactKind, RelationType } from "./enums";
import { paginated } from "./common";

/** A comment as shown in the UI/MCP (body, author name, date). */
export const CommentView = z.object({
  id: z.string().uuid(),
  authorName: z.string(),
  body: z.string(),
  createdAt: z.string().datetime(),
});
export type CommentView = z.infer<typeof CommentView>;

export const CreateCommentInput = z.object({
  body: z.string().min(1).max(10_000),
});
export type CreateCommentInput = z.infer<typeof CreateCommentInput>;

export const ShareLinkView = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  revoked: z.boolean(),
  createdAt: z.string().datetime(),
});
export type ShareLinkView = z.infer<typeof ShareLinkView>;

/** GET /api/s/:token JSON body (Accept: application/json) — mirrors DownloadUrlResponse's
 * content-negotiation pattern so SPA `fetch` callers avoid a cross-origin redirect chain. */
export const ShareLinkRedemptionResponse = z.object({
  artifactId: z.string().uuid(),
});
export type ShareLinkRedemptionResponse = z.infer<typeof ShareLinkRedemptionResponse>;

/** One relationship to link, either inline at publish time (`publish_artifact`'s
 * `relationships`) or via a dedicated `link_artifacts` call / POST .../relationships. */
export const ArtifactRelationshipInput = z.object({
  toId: z.string().uuid(),
  type: RelationType,
  /** Short free-text label, e.g. "post-processed export" — not a second description field. */
  note: z.string().max(280).optional(),
});
export type ArtifactRelationshipInput = z.infer<typeof ArtifactRelationshipInput>;

/** GET .../relationships row — resolved enough to render without a follow-up fetch.
 * `otherArtifact` is null when the caller can't view the other side (redacted, not leaked —
 * see docs/architecture/06 §2). */
export const ArtifactRelationshipSummary = z.object({
  id: z.string().uuid(),
  type: RelationType,
  direction: z.enum(["outgoing", "incoming"]),
  note: z.string().nullable(),
  otherArtifact: z
    .object({
      id: z.string().uuid(),
      title: z.string(),
      kind: ArtifactKind,
      ownerId: z.string().uuid(),
    })
    .nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ArtifactRelationshipSummary = z.infer<typeof ArtifactRelationshipSummary>;

/** POST .../relationships response. */
export const ArtifactRelationshipCreateResponse = z.object({
  relationshipId: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type ArtifactRelationshipCreateResponse = z.infer<typeof ArtifactRelationshipCreateResponse>;

/** Per-entry outcome of linking one relationship — used when several are requested at once
 * (`publish_artifact`'s `relationships`, `POST /api/artifacts`'s `relationships`) so a bad `toId`
 * is reported rather than silently dropped or failing the whole request. */
export const ArtifactRelationshipLinkResult = z.union([
  z.object({ ok: z.literal(true), relationshipId: z.string().uuid(), createdAt: z.string().datetime() }),
  z.object({
    ok: z.literal(false),
    toId: z.string().uuid(),
    type: RelationType,
    reason: z.enum(["self_link", "to_not_found", "to_not_viewable", "duplicate"]),
  }),
]);
export type ArtifactRelationshipLinkResult = z.infer<typeof ArtifactRelationshipLinkResult>;

/** `list_relationships` (MCP) / `GET /api/relationships` request — corpus-wide, optionally
 * filtered to one `type`, unlike `ListArtifactRelationshipsInput` which is scoped to one
 * artifact's `id`. Omit `type` to pull every relationship type in one call. `limit` uses
 * `z.coerce` (like `ArtifactListQuery`'s) so this schema works unchanged against both MCP's
 * already-typed JSON args and REST's string query params. */
export const ListRelationshipsInput = z.object({
  type: RelationType.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});
export type ListRelationshipsInput = z.infer<typeof ListRelationshipsInput>;

/** One endpoint (`from` or `to`) of a `RelationshipRow` — same shape as
 * `ArtifactRelationshipSummary`'s `otherArtifact`. */
export const RelationshipEndpoint = z.object({
  id: z.string().uuid(),
  title: z.string(),
  kind: ArtifactKind,
  ownerId: z.string().uuid(),
});
export type RelationshipEndpoint = z.infer<typeof RelationshipEndpoint>;

/** A row from `list_relationships` / `GET /api/relationships` — both `from` and `to` are shown
 * (unlike `ArtifactRelationshipSummary`'s single `otherArtifact`, there's no anchor artifact this
 * row is "outgoing/incoming" relative to). Each side is independently null when the caller can't
 * view that artifact — same redaction rule as `otherArtifact`, applied to both ends instead of
 * just the far one. A row with neither side viewable is never returned at all. */
export const RelationshipRow = z.object({
  id: z.string().uuid(),
  type: RelationType,
  note: z.string().nullable(),
  from: RelationshipEndpoint.nullable(),
  to: RelationshipEndpoint.nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type RelationshipRow = z.infer<typeof RelationshipRow>;

export const RelationshipListResponse = paginated(RelationshipRow);
export type RelationshipListResponse = z.infer<typeof RelationshipListResponse>;
