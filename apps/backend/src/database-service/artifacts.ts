import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AccessAction, AccessRoute, ArtifactDetail, ArtifactKind, ArtifactSummary, AudienceType } from "contracts";
import { prisma } from "../db";
import { canView, type ArtifactPolicy, type Decision, type Viewer } from "../core/authz";
import { recordAccessEvent } from "./accessEvents";
import { findUsersByEmails } from "./adminUsers";
import { findGroupsByNames } from "./groups";
import { getPresignedUploadUrl, headObject } from "../storage/s3";

const withPolicyJoins = Prisma.validator<Prisma.ArtifactDefaultArgs>()({
  include: {
    owner: { select: { id: true, name: true } },
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
  };
}

function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && now >= expiresAt;
}

export function toSummary(artifact: ArtifactWithPolicyJoins, now: Date): ArtifactSummary {
  return {
    id: artifact.id,
    title: artifact.title,
    fileName: artifact.fileName,
    contentType: artifact.contentType,
    kind: artifact.kind,
    format: artifact.format,
    sizeBytes: Number(artifact.sizeBytes),
    publisherName: artifact.owner.name,
    publishedAt: artifact.createdAt.toISOString(),
    audienceType: artifact.audienceType,
    expiresAt: artifact.expiresAt?.toISOString() ?? null,
    isExpired: isExpired(artifact.expiresAt, now),
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
    ownerId: artifact.ownerId,
    canManagePolicy: artifact.ownerId === viewerId,
  };
}

export interface ListOwnedArtifactsResult {
  items: ArtifactWithPolicyJoins[];
  nextCursor: string | null;
}

/** "My Artifacts" — owner's own, newest first (implementation-plan.md Phase 2). */
export async function listOwnedArtifacts(
  ownerId: string,
  { limit, cursor }: { limit: number; cursor?: string },
): Promise<ListOwnedArtifactsResult> {
  const rows = await prisma.artifact.findMany({
    where: { ownerId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    ...withPolicyJoins,
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? last.id : null };
}

export interface UpdateArtifactPolicyInput {
  audienceType: AudienceType;
  expiresAt: Date | null;
  allowedUserIds: string[];
  allowedGroupIds: string[];
  updatedById: string;
}

/** Revocation is just re-writing the policy (docs/architecture/03 §4) — no separate mechanism. */
export async function updateArtifactPolicy(
  artifactId: string,
  input: UpdateArtifactPolicyInput,
): Promise<void> {
  await prisma.$transaction([
    prisma.artifactAllowedUser.deleteMany({ where: { artifactId } }),
    prisma.artifactAllowedGroup.deleteMany({ where: { artifactId } }),
    prisma.artifact.update({
      where: { id: artifactId },
      data: {
        audienceType: input.audienceType,
        expiresAt: input.expiresAt,
        policyUpdatedAt: new Date(),
        policyUpdatedById: input.updatedById,
      },
    }),
    ...input.allowedUserIds.map((userId) =>
      prisma.artifactAllowedUser.create({ data: { artifactId, userId } }),
    ),
    ...input.allowedGroupIds.map((groupId) =>
      prisma.artifactAllowedGroup.create({ data: { artifactId, groupId } }),
    ),
  ]);
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
  format?: string;
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

  await prisma.artifact.create({
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
      format: input.format,
      language: input.language,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      audienceType: input.audienceType,
      expiresAt: input.expiresAt,
      policyUpdatedById: ownerId,
      allowedUsers: { create: input.allowedUserIds.map((userId) => ({ userId })) },
      allowedGroups: { create: input.allowedGroupIds.map((groupId) => ({ groupId })) },
    },
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

export interface ListSharedWithMeInput {
  sinceHours?: number;
  cursor?: string;
  limit: number;
}

/**
 * "Shared with me" (MCP `list_shared_with_me`, docs/architecture/05 §4): everything visible to
 * the viewer that they don't own, live (not expired — a non-owner can't view an expired artifact
 * regardless of audience, so excluding it here matches `canView`), optionally bounded to the last
 * `sinceHours`.
 */
export async function listSharedWithMe(
  viewer: Viewer,
  { sinceHours, cursor, limit }: ListSharedWithMeInput,
): Promise<ListOwnedArtifactsResult> {
  const now = new Date();
  const since = sinceHours ? new Date(now.getTime() - sinceHours * 60 * 60 * 1000) : undefined;

  const audienceClauses: Prisma.ArtifactWhereInput[] = [
    { audienceType: "public_authenticated" },
    { audienceType: "specific_users", allowedUsers: { some: { userId: viewer.id } } },
  ];
  if (viewer.groupIds.length > 0) {
    audienceClauses.push({
      audienceType: "user_groups",
      allowedGroups: { some: { groupId: { in: viewer.groupIds } } },
    });
  }

  const rows = await prisma.artifact.findMany({
    where: {
      AND: [
        { ownerId: { not: viewer.id } },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        { OR: audienceClauses },
        ...(since ? [{ createdAt: { gte: since } }] : []),
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    ...withPolicyJoins,
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? last.id : null };
}
