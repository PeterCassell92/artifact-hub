import type { AccessAction, AccessDecision, AccessEventView, AccessRoute } from "contracts";
import { prisma } from "../db";
import type { DenyReason } from "../core/authz";
import { paginateRows } from "./artifacts";

export interface RecordAccessEventInput {
  artifactId: string;
  userId: string;
  route: AccessRoute;
  action: AccessAction;
  decision: AccessDecision;
  denyReason?: DenyReason;
  shareLinkId?: string;
}

/**
 * Writes the artifact-access audit trail (docs/models/access-event.md) — both allowed and
 * denied attempts, so revocation/expiry are provable. Called from every access path (ui /
 * share_link / mcp / system); Phase 2 only wires the `ui` route.
 *
 * An **allowed** event also touches `Artifact.lastAccessedAt` (architecture/01 §5 decision #45)
 * so `sort=lastAccessed` (frontend/02 §3) has a stable, indexed column to order/cursor on — except
 * for `route: "system"` (the enrichment job's own content reads, decision #46), which shouldn't
 * make an artifact look freshly "viewed" every time a background job runs over it.
 */
export async function recordAccessEvent(input: RecordAccessEventInput): Promise<void> {
  const at = new Date();
  const bumpsLastAccessed = input.decision === "allowed" && input.route !== "system";

  await prisma.$transaction([
    prisma.accessEvent.create({
      data: {
        artifactId: input.artifactId,
        userId: input.userId,
        route: input.route,
        action: input.action,
        decision: input.decision,
        denyReason: input.denyReason,
        shareLinkId: input.shareLinkId,
        at,
      },
    }),
    ...(bumpsLastAccessed
      ? [prisma.artifact.update({ where: { id: input.artifactId }, data: { lastAccessedAt: at } })]
      : []),
  ]);
}

export interface ListAccessEventsResult {
  items: AccessEventView[];
  nextCursor: string | null;
}

/**
 * The access-history read side of `docs/models/access-event.md` §6 — newest first, cursor-paginated
 * (`AccessEvent` is high-volume, unlike the unpaginated `CommentView` list). Authorization
 * (owner-or-admin for REST, owner-only for MCP) is the caller's responsibility, same as
 * `listComments`/`listRelationships`.
 */
export async function listAccessEvents(
  artifactId: string,
  { cursor, limit }: { cursor?: string; limit: number },
): Promise<ListAccessEventsResult> {
  const rows = await prisma.accessEvent.findMany({
    where: { artifactId },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { user: { select: { name: true, email: true } } },
  });

  const { items, nextCursor } = paginateRows(rows, limit);
  return {
    items: items.map((row) => ({
      id: row.id,
      userId: row.userId,
      userName: row.user.name,
      userEmail: row.user.email,
      action: row.action,
      route: row.route,
      decision: row.decision,
      denyReason: row.denyReason ?? undefined,
      at: row.at.toISOString(),
    })),
    nextCursor,
  };
}
