import { Prisma } from "@prisma/client";
import type { ArtifactDetail, ArtifactSummary } from "contracts";
import { prisma } from "../db";
import type { ArtifactPolicy } from "../core/authz";

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
