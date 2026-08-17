import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AccessAction, AccessRoute, ArtifactDetail, ArtifactKind, ArtifactSummary, AudienceType } from "contracts";
import { prisma } from "../db";
import { canView, type ArtifactPolicy, type Decision, type Viewer } from "../core/authz";
import { recordAccessEvent } from "./accessEvents";
import { findUsersByEmails } from "./adminUsers";
import { findGroupsByNames } from "./groups";
import { getPresignedUploadUrl, headObject } from "../storage/s3";
import { enqueueOutboxEvent, type EnqueueOutboxEventInput } from "./outbox";
import { buildPublishNotificationEvents } from "./artifactRecipients";

const withPolicyJoins = Prisma.validator<Prisma.ArtifactDefaultArgs>()({
  include: {
    owner: { select: { id: true, name: true, email: true } },
    allowedUsers: { select: { userId: true } },
    allowedGroups: { select: { groupId: true } },
    _count: { select: { comments: true } },
  },
});
type ArtifactWithPolicyJoins = Prisma.ArtifactGetPayload<typeof withPolicyJoins>;

/** Fetches one artifact with everything canView/canManagePolicy and the detail response need. */
export function findArtifactForDetail(id: string): Promise<ArtifactWithPolicyJoins | null> {
  return prisma.artifact.findUnique({ where: { id }, ...withPolicyJoins });
}

/** Maps a fetched artifact row to the `core/authz` policy shape. */
export function toPolicy(artifact: ArtifactWithPolicyJoins): ArtifactPolicy {
  return {
    ownerId: artifact.ownerId,
    audienceType: artifact.audienceType,
    expiresAt: artifact.expiresAt,
    allowedUserIds: artifact.allowedUsers.map((a) => a.userId),
    allowedGroupIds: artifact.allowedGroups.map((a) => a.groupId),
    revoked: artifact.revoked,
  };
}

function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && now >= expiresAt;
}

export function toSummary(artifact: ArtifactWithPolicyJoins, now: Date): ArtifactSummary {
  return {
    id: artifact.id,
    ownerId: artifact.ownerId,
    title: artifact.title,
    fileName: artifact.fileName,
    contentType: artifact.contentType,
    kind: artifact.kind,
    sizeBytes: Number(artifact.sizeBytes),
    publisherName: artifact.owner.name,
    publishedAt: artifact.createdAt.toISOString(),
    audienceType: artifact.audienceType,
    expiresAt: artifact.expiresAt?.toISOString() ?? null,
    isExpired: isExpired(artifact.expiresAt, now),
    revoked: artifact.revoked,
    commentCount: artifact._count.comments,
  };
}

export function toDetail(
  artifact: ArtifactWithPolicyJoins,
  viewerId: string,
  now: Date,
): ArtifactDetail {
  return {
    ...toSummary(artifact, now),
    description: artifact.description,
    canManagePolicy: artifact.ownerId === viewerId,
  };
}

export interface ListOwnedArtifactsResult {
  items: ArtifactWithPolicyJoins[];
  nextCursor: string | null;
}

/**
 * The search/facet/sort part of `ArtifactListQuery` (implementation-plan.md Phase 7,
 * docs/frontend/02-filtering-and-search.md), minus `scope`/`cursor`/`limit` which each list
 * function takes as its own params. `audienceType`/`isExpired` are only honoured by
 * `listOwnedArtifacts`; `publisherId` only by `listSharedWithMe` — see `ArtifactListQuery`'s doc
 * comment in packages/contracts for why the other scope silently ignores them.
 */
export interface ArtifactListFilters {
  q?: string;
  contentType?: string[];
  kind?: ArtifactKind[];
  tags?: string[];
  sourceTool?: string[];
  audienceType?: AudienceType[];
  isExpired?: boolean;
  publisherId?: string[];
  sinceHours?: number;
  sort?: "published" | "title" | "lastAccessed" | "size";
}

function paginateRows<T extends { id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? last.id : null };
}

/** Search (`q`) + facet (`contentType`/`kind`/`tags`/`sourceTool`) clauses shared by both list
 * functions and `getArtifactFacets` — `q` matches title/description/fileName/tags (02 §1). */
function buildFacetClauses(
  filters: Pick<ArtifactListFilters, "q" | "contentType" | "kind" | "tags" | "sourceTool">,
): Prisma.ArtifactWhereInput[] {
  const clauses: Prisma.ArtifactWhereInput[] = [];

  if (filters.q) {
    clauses.push({
      OR: [
        { title: { contains: filters.q, mode: "insensitive" } },
        { description: { contains: filters.q, mode: "insensitive" } },
        { fileName: { contains: filters.q, mode: "insensitive" } },
        { tags: { some: { tag: { name: { contains: filters.q, mode: "insensitive" } } } } },
      ],
    });
  }
  if (filters.contentType?.length) clauses.push({ contentType: { in: filters.contentType } });
  if (filters.kind?.length) clauses.push({ kind: { in: filters.kind } });
  if (filters.tags?.length) {
    clauses.push({ tags: { some: { tag: { name: { in: filters.tags } } } } });
  }
  if (filters.sourceTool?.length) clauses.push({ sourceTool: { in: filters.sourceTool } });

  return clauses;
}

function buildOrderBy(sort: ArtifactListFilters["sort"]): Prisma.ArtifactOrderByWithRelationInput[] {
  switch (sort) {
    case "title":
      return [{ title: "asc" }, { id: "asc" }];
    case "size":
      return [{ sizeBytes: "desc" }, { id: "desc" }];
    case "lastAccessed":
      return [{ lastAccessedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }];
    case "published":
    default:
      return [{ createdAt: "desc" }, { id: "desc" }];
  }
}

/**
 * The base "which artifacts can this viewer see under this scope" clause — shared by the two
 * list functions and `getArtifactFacets` so facet options never widen beyond what a list call
 * with the same scope would actually return.
 */
function scopeEligibilityWhere(
  viewerId: string,
  viewerGroupIds: string[],
  scope: "mine" | "sharedWithMe",
  now: Date,
): Prisma.ArtifactWhereInput {
  if (scope === "mine") {
    return { ownerId: viewerId };
  }

  const audienceClauses: Prisma.ArtifactWhereInput[] = [
    { audienceType: "public_authenticated" },
    { audienceType: "specific_users", allowedUsers: { some: { userId: viewerId } } },
  ];
  if (viewerGroupIds.length > 0) {
    audienceClauses.push({
      audienceType: "user_groups",
      allowedGroups: { some: { groupId: { in: viewerGroupIds } } },
    });
  }

  return {
    AND: [
      { ownerId: { not: viewerId } },
      { revoked: false },
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      { OR: audienceClauses },
    ],
  };
}

/** "My Artifacts" — owner's own (implementation-plan.md Phase 2, extended with filters/sort in
 * Phase 7). */
export async function listOwnedArtifacts(
  ownerId: string,
  { limit, cursor, ...filters }: ArtifactListFilters & { limit: number; cursor?: string },
): Promise<ListOwnedArtifactsResult> {
  const now = new Date();
  const since = filters.sinceHours
    ? new Date(now.getTime() - filters.sinceHours * 60 * 60 * 1000)
    : undefined;

  const where: Prisma.ArtifactWhereInput = {
    AND: [
      scopeEligibilityWhere(ownerId, [], "mine", now),
      ...buildFacetClauses(filters),
      ...(since ? [{ createdAt: { gte: since } }] : []),
      ...(filters.audienceType?.length ? [{ audienceType: { in: filters.audienceType } }] : []),
      ...(filters.isExpired === true ? [{ expiresAt: { not: null, lte: now } }] : []),
      ...(filters.isExpired === false
        ? [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }]
        : []),
    ],
  };

  const rows = await prisma.artifact.findMany({
    where,
    orderBy: buildOrderBy(filters.sort),
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    ...withPolicyJoins,
  });

  return paginateRows(rows, limit);
}

export interface UpdateArtifactPolicyInput {
  audienceType: AudienceType;
  expiresAt: Date | null;
  allowedUserIds: string[];
  allowedGroupIds: string[];
  updatedById: string;
}

/**
 * Narrowing the policy (docs/architecture/03 §4) is the general revocation mechanism. Always
 * clears `revoked` back to `false` — applying a fresh, deliberate policy is the opposite of the
 * explicit instant cutoff `revokeArtifactAccess` sets, so it un-does it as a side effect (this is
 * the persistence half of "Re-open Access": the owner unlocks the form client-side, then Save
 * here is what actually clears the flag).
 */
export async function updateArtifactPolicy(
  artifactId: string,
  input: UpdateArtifactPolicyInput,
  notificationEvents: EnqueueOutboxEventInput[] = [],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.artifactAllowedUser.deleteMany({ where: { artifactId } });
    await tx.artifactAllowedGroup.deleteMany({ where: { artifactId } });
    await tx.artifact.update({
      where: { id: artifactId },
      data: {
        audienceType: input.audienceType,
        expiresAt: input.expiresAt,
        revoked: false,
        policyUpdatedAt: new Date(),
        policyUpdatedById: input.updatedById,
      },
    });
    for (const userId of input.allowedUserIds) {
      await tx.artifactAllowedUser.create({ data: { artifactId, userId } });
    }
    for (const groupId of input.allowedGroupIds) {
      await tx.artifactAllowedGroup.create({ data: { artifactId, groupId } });
    }
    for (const event of notificationEvents) {
      await enqueueOutboxEvent(event, tx);
    }
  });
}

/**
 * The explicit "Revoke all access" cutoff — sets `revoked` without touching audience/expiry, so
 * whatever policy was in effect is preserved (visible again once the owner re-opens it) rather
 * than destroyed. Independent of `expiresAt`/`isExpired` (03 §1a) so the UI can tell "you revoked
 * this" apart from "its expiry window ran out on its own".
 */
export async function revokeArtifactAccess(
  artifactId: string,
  revokedById: string,
  notificationEvents: EnqueueOutboxEventInput[] = [],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.artifact.update({
      where: { id: artifactId },
      data: { revoked: true, policyUpdatedAt: new Date(), policyUpdatedById: revokedById },
    });
    for (const event of notificationEvents) {
      await enqueueOutboxEvent(event, tx);
    }
  });
}

/**
 * `canView` + `AccessEvent` write, in one place — used by every access path that both decides
 * and audits (REST detail/download, MCP `get_artifact`, MCP `artifact://<id>` resource) so the
 * "every access is audited, allowed and denied" rule (CLAUDE.md) can't drift between them.
 */
export async function checkViewAndAudit(
  viewer: Viewer,
  artifact: ArtifactWithPolicyJoins,
  route: AccessRoute,
  action: AccessAction,
): Promise<Decision> {
  const decision = canView(viewer, toPolicy(artifact), new Date());

  await recordAccessEvent({
    artifactId: artifact.id,
    userId: viewer.id,
    route,
    action,
    decision: decision.allowed ? "allowed" : "denied",
    denyReason: decision.reason,
  });

  return decision;
}

export interface AudienceInput {
  audienceType: AudienceType;
  userEmails?: string[];
  groupNames?: string[];
}

export type ResolvedAudience =
  | { ok: true; audienceType: AudienceType; allowedUserIds: string[]; allowedGroupIds: string[] }
  | { ok: false; error: string; details: Record<string, unknown> };

/**
 * Resolves `userEmails`/`groupNames` to ids, rejecting unknowns — shared by the REST policy
 * route, `set_access_policy`, and `publish_artifact` (all three set/replace an artifact's
 * audience) so the unknown-email/unknown-group behaviour can't diverge between them.
 */
export async function resolveAudienceInput(input: AudienceInput): Promise<ResolvedAudience> {
  if (input.audienceType === "specific_users") {
    const emails = input.userEmails ?? [];
    const users = await findUsersByEmails(emails);
    const foundEmails = new Set(users.map((u) => u.email));
    const unknown = emails.filter((e) => !foundEmails.has(e));
    if (unknown.length > 0) {
      return { ok: false, error: "Unknown user email(s)", details: { unknownEmails: unknown } };
    }
    return {
      ok: true,
      audienceType: input.audienceType,
      allowedUserIds: users.map((u) => u.id),
      allowedGroupIds: [],
    };
  }

  if (input.audienceType === "user_groups") {
    const names = input.groupNames ?? [];
    const groups = await findGroupsByNames(names);
    const foundNames = new Set(groups.map((g) => g.name));
    const unknown = names.filter((n) => !foundNames.has(n));
    if (unknown.length > 0) {
      return { ok: false, error: "Unknown group name(s)", details: { unknownGroups: unknown } };
    }
    return {
      ok: true,
      audienceType: input.audienceType,
      allowedUserIds: [],
      allowedGroupIds: groups.map((g) => g.id),
    };
  }

  return { ok: true, audienceType: input.audienceType, allowedUserIds: [], allowedGroupIds: [] };
}

/** findOrCreate by name + link — tag counts are low in v1, a loop is plenty. */
export async function attachTags(artifactId: string, tagNames: string[]): Promise<void> {
  for (const name of tagNames) {
    const tag = await prisma.tag.upsert({ where: { name }, update: {}, create: { name } });
    await prisma.artifactTag.create({ data: { artifactId, tagId: tag.id } });
  }
}

function sanitizeKeySegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export interface CreateArtifactPendingInput {
  title: string;
  description?: string;
  fileName: string;
  contentType: string;
  kind?: ArtifactKind;
  tags?: string[];
  sourceTool?: string;
  language?: string;
  metadata?: Record<string, unknown>;
  audienceType: AudienceType;
  allowedUserIds: string[];
  allowedGroupIds: string[];
  expiresAt: Date | null;
}

export interface CreateArtifactPendingResult {
  artifact: ArtifactWithPolicyJoins;
  uploadUrl: string;
}

/**
 * Step 1 of the `publish_artifact` two-call flow (docs/architecture/01 decision #44): creates the
 * artifact row + its access policy up front (`sizeBytes`/`checksumSha256` are placeholders until
 * `finalizeArtifact` runs) and returns a presigned PUT so bytes go straight to Tigris/MinIO —
 * never through the MCP tool call.
 */
export async function createArtifactPending(
  ownerId: string,
  input: CreateArtifactPendingInput,
): Promise<CreateArtifactPendingResult> {
  const id = randomUUID();
  const storageKey = `artifacts/${id}/${sanitizeKeySegment(input.fileName)}`;

  const notificationEvents = await buildPublishNotificationEvents(id, ownerId, {
    audienceType: input.audienceType,
    allowedUserIds: input.allowedUserIds,
    allowedGroupIds: input.allowedGroupIds,
  });

  await prisma.$transaction(async (tx) => {
    await tx.artifact.create({
      data: {
        id,
        ownerId,
        title: input.title,
        description: input.description,
        fileName: input.fileName,
        contentType: input.contentType,
        storageKey,
        sizeBytes: BigInt(0),
        kind: input.kind ?? "other",
        sourceTool: input.sourceTool,
        language: input.language,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        audienceType: input.audienceType,
        expiresAt: input.expiresAt,
        policyUpdatedById: ownerId,
        allowedUsers: { create: input.allowedUserIds.map((userId) => ({ userId })) },
        allowedGroups: { create: input.allowedGroupIds.map((groupId) => ({ groupId })) },
      },
    });
    for (const event of notificationEvents) {
      await enqueueOutboxEvent(event, tx);
    }
  });

  if (input.tags?.length) {
    await attachTags(id, input.tags);
  }

  const uploadUrl = await getPresignedUploadUrl(storageKey, { contentType: input.contentType });
  const artifact = await findArtifactForDetail(id);
  return { artifact: artifact!, uploadUrl };
}

export type FinalizeArtifactResult =
  | { ok: true; artifact: ArtifactWithPolicyJoins }
  | { ok: false; reason: "not_found" | "forbidden" | "object_missing" };

/**
 * Step 2 of the `publish_artifact` flow: confirms the presigned-PUT upload actually landed
 * (`HeadObject`) before recording size/checksum — a bare `bytesRef` can't fake a finalize.
 */
export async function finalizeArtifact(
  artifactId: string,
  ownerId: string,
  input: { checksumSha256?: string },
): Promise<FinalizeArtifactResult> {
  const artifact = await findArtifactForDetail(artifactId);
  if (!artifact) return { ok: false, reason: "not_found" };
  if (artifact.ownerId !== ownerId) return { ok: false, reason: "forbidden" };

  const head = await headObject(artifact.storageKey);
  if (!head) return { ok: false, reason: "object_missing" };

  await prisma.artifact.update({
    where: { id: artifactId },
    data: { sizeBytes: BigInt(head.sizeBytes), checksumSha256: input.checksumSha256 },
  });

  const updated = await findArtifactForDetail(artifactId);
  return { ok: true, artifact: updated! };
}

/**
 * "Shared with me" (MCP `list_shared_with_me`, docs/architecture/05 §4): everything visible to
 * the viewer that they don't own, live (not expired — a non-owner can't view an expired artifact
 * regardless of audience, so excluding it here matches `canView`), optionally bounded to the last
 * `sinceHours` and the Phase 7 filters/sort.
 */
export async function listSharedWithMe(
  viewer: Viewer,
  { limit, cursor, ...filters }: ArtifactListFilters & { limit: number; cursor?: string },
): Promise<ListOwnedArtifactsResult> {
  const now = new Date();
  const since = filters.sinceHours
    ? new Date(now.getTime() - filters.sinceHours * 60 * 60 * 1000)
    : undefined;

  const where: Prisma.ArtifactWhereInput = {
    AND: [
      scopeEligibilityWhere(viewer.id, viewer.groupIds, "sharedWithMe", now),
      ...buildFacetClauses(filters),
      ...(since ? [{ createdAt: { gte: since } }] : []),
      ...(filters.publisherId?.length ? [{ ownerId: { in: filters.publisherId } }] : []),
    ],
  };

  const rows = await prisma.artifact.findMany({
    where,
    orderBy: buildOrderBy(filters.sort),
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    ...withPolicyJoins,
  });

  return paginateRows(rows, limit);
}

export interface ArtifactFacetOptionsResult {
  contentTypes: string[];
  tags: string[];
  sourceTools: string[];
  publishers: { id: string; name: string | null }[];
}

/**
 * Distinct filter values the viewer can actually use, scoped to the same eligibility as the list
 * functions (`GET /api/artifacts/facets`) — populates the frontend's multi-select controls with
 * real values rather than a guessed/fixed catalogue (`contentType` and `tags` are free-form).
 * Computed against the *unfiltered* scope-eligible set, not the caller's currently-active
 * filters, so option lists stay stable as the user narrows down (a common faceted-search
 * simplification — not "counts excluding this facet").
 */
export async function getArtifactFacets(
  viewer: Viewer,
  scope: "mine" | "sharedWithMe",
): Promise<ArtifactFacetOptionsResult> {
  const now = new Date();
  const where = scopeEligibilityWhere(viewer.id, viewer.groupIds, scope, now);

  const [contentTypeRows, sourceToolRows, tagRows, publisherRows] = await Promise.all([
    prisma.artifact.findMany({ where, distinct: ["contentType"], select: { contentType: true } }),
    prisma.artifact.findMany({
      where: { ...where, sourceTool: { not: null } },
      distinct: ["sourceTool"],
      select: { sourceTool: true },
    }),
    prisma.tag.findMany({
      where: { artifacts: { some: { artifact: where } } },
      distinct: ["name"],
      select: { name: true },
    }),
    scope === "sharedWithMe"
      ? prisma.artifact.findMany({
          where,
          distinct: ["ownerId"],
          select: { owner: { select: { id: true, name: true } } },
        })
      : Promise.resolve([]),
  ]);

  return {
    contentTypes: contentTypeRows.map((r) => r.contentType),
    tags: tagRows.map((r) => r.name),
    sourceTools: sourceToolRows.flatMap((r) => (r.sourceTool ? [r.sourceTool] : [])),
    publishers: publisherRows.map((r) => r.owner),
  };
}
