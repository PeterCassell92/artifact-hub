import { Prisma } from "@prisma/client";
import type { ArtifactRelationshipInput, ArtifactRelationshipSummary, RelationshipRow, RelationType } from "contracts";
import { prisma } from "../db";
import { canManagePolicy, canView, type Viewer } from "../core/authz";
import { findArtifactForDetail, paginateRows, toPolicy, visibleArtifactWhere, withPolicyJoins } from "./artifacts";

export type CreateRelationshipResult =
  | { ok: true; relationshipId: string; createdAt: Date }
  | {
      ok: false;
      toId: string;
      type: RelationType;
      reason: "self_link" | "to_not_found" | "to_not_viewable" | "duplicate";
    };

/** Extra fields only the enrichment job sets — never exposed on the user-facing
 * `ArtifactRelationshipInput` contract (`link_artifacts`/`publish_artifact` always create
 * `source: "human"` rows). */
export interface CreateRelationshipProvenance {
  source?: "human" | "ai";
  confidence?: number;
}

/**
 * Links `fromId` -> `input.toId`. Ownership of `fromId` is the caller's responsibility to check
 * before calling this (matches `updateArtifactPolicy`/`revokeArtifactAccess` — owner-only routes
 * check `canManagePolicy` themselves; a brand-new artifact from `createArtifactPending` is
 * trivially owned by its creator). This function only validates the *target* side: `toId` must
 * exist and be visible to `linker`, so an owner can't assert a relationship to an artifact whose
 * existence they can't already see (03 — canView is the one authorization gate, never bypassed).
 */
export async function createRelationship(
  fromId: string,
  linker: Viewer,
  input: ArtifactRelationshipInput,
  provenance: CreateRelationshipProvenance = {},
): Promise<CreateRelationshipResult> {
  if (fromId === input.toId) {
    return { ok: false, toId: input.toId, type: input.type, reason: "self_link" };
  }

  const to = await findArtifactForDetail(input.toId);
  if (!to) {
    return { ok: false, toId: input.toId, type: input.type, reason: "to_not_found" };
  }

  const decision = canView(linker, toPolicy(to), new Date());
  if (!decision.allowed) {
    return { ok: false, toId: input.toId, type: input.type, reason: "to_not_viewable" };
  }

  try {
    const relationship = await prisma.artifactRelationship.create({
      data: {
        fromId,
        toId: input.toId,
        type: input.type,
        note: input.note,
        createdById: linker.id,
        source: provenance.source ?? "human",
        confidence: provenance.confidence,
      },
    });
    return { ok: true, relationshipId: relationship.id, createdAt: relationship.createdAt };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, toId: input.toId, type: input.type, reason: "duplicate" };
    }
    throw err;
  }
}

/** Bulk variant for `publish_artifact`'s optional `relationships` — one artifact just published,
 * several links at once. Each entry is validated/created independently (a bad `toId` doesn't
 * block the others, or the publish itself — the artifact row already exists by the time this
 * runs, same as `attachTags`) so the caller can report per-relationship outcomes. */
export async function createRelationships(
  fromId: string,
  linker: Viewer,
  inputs: ArtifactRelationshipInput[],
): Promise<CreateRelationshipResult[]> {
  const results: CreateRelationshipResult[] = [];
  for (const input of inputs) {
    results.push(await createRelationship(fromId, linker, input));
  }
  return results;
}

export type DeleteRelationshipResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "forbidden" };

/**
 * Removes a relationship. Ownership follows the `from` side, same as creating one — the owner of
 * `fromId` is the one who asserted the relationship, so they're the one who can retract it; the
 * `to` side's owner has no say (matches how they had no say in it being created either). Editing
 * a relationship in place isn't supported (v1) — retract and re-`link_artifacts` instead.
 */
export async function deleteRelationship(
  relationshipId: string,
  remover: Viewer,
): Promise<DeleteRelationshipResult> {
  const relationship = await prisma.artifactRelationship.findUnique({ where: { id: relationshipId } });
  if (!relationship) return { ok: false, reason: "not_found" };

  const from = await findArtifactForDetail(relationship.fromId);
  if (!from || !canManagePolicy(remover, toPolicy(from))) {
    return { ok: false, reason: "forbidden" };
  }

  await prisma.artifactRelationship.delete({ where: { id: relationshipId } });
  return { ok: true };
}

/**
 * Every relationship touching `artifactId`, either direction, newest first. `otherArtifact` is
 * resolved through `canView` per row and nulled out (not dropped — the relationship's existence
 * and type still tell you something) when the caller can't see the other side, so a relationship
 * on a visible artifact can never leak the title/owner of a private one on its far end.
 */
export async function listRelationships(
  viewer: Viewer,
  artifactId: string,
): Promise<ArtifactRelationshipSummary[]> {
  const rows = await prisma.artifactRelationship.findMany({
    where: { OR: [{ fromId: artifactId }, { toId: artifactId }] },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true } } },
  });
  if (rows.length === 0) return [];

  const otherIds = [...new Set(rows.map((r) => (r.fromId === artifactId ? r.toId : r.fromId)))];
  const otherArtifacts = await Promise.all(otherIds.map((id) => findArtifactForDetail(id)));
  const otherById = new Map(otherArtifacts.flatMap((a) => (a ? [[a.id, a] as const] : [])));

  const now = new Date();
  return rows.map((row) => {
    const direction = row.fromId === artifactId ? "outgoing" : "incoming";
    const otherId = direction === "outgoing" ? row.toId : row.fromId;
    const other = otherById.get(otherId);
    const canSeeOther = other !== undefined && canView(viewer, toPolicy(other), now).allowed;

    return {
      id: row.id,
      type: row.type,
      direction,
      note: row.note,
      otherArtifact:
        canSeeOther && other
          ? { id: other.id, title: other.title, kind: other.kind, ownerId: other.ownerId }
          : null,
      createdByName: row.createdBy.name,
      createdAt: row.createdAt.toISOString(),
      source: row.source,
      confidence: row.confidence,
    };
  });
}

export interface ListRelationshipsByTypeResult {
  items: RelationshipRow[];
  nextCursor: string | null;
}

/**
 * Corpus-wide relationship listing, optionally filtered to one `type` — the bulk counterpart to
 * `listRelationships`, which is scoped to one artifact you've already confirmed you can view.
 * There's no anchor artifact here, so visibility works in two steps: the SQL `where` only matches
 * rows where the viewer can see `from` OR `to` (via `visibleArtifactWhere` — same policy logic as
 * `canView`, expressed as a Prisma clause so pagination stays correct), then each side is
 * independently redacted to `null` in memory via `canView`/`toPolicy` if the viewer can't see that
 * particular artifact — same rule as `listRelationships`'s `otherArtifact: null`, just applied to
 * both ends instead of only the far one. A row with neither side viewable never reaches this
 * function's caller — the SQL `where` excludes it outright.
 */
export async function listRelationshipsByType(
  viewer: Viewer,
  type: RelationType | undefined,
  { cursor, limit }: { cursor?: string; limit: number },
): Promise<ListRelationshipsByTypeResult> {
  const now = new Date();
  const visible = visibleArtifactWhere(viewer.id, viewer.groupIds, now);

  const rows = await prisma.artifactRelationship.findMany({
    where: { ...(type ? { type } : {}), OR: [{ from: visible }, { to: visible }] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { createdBy: { select: { name: true } }, from: withPolicyJoins, to: withPolicyJoins },
  });

  const { items, nextCursor } = paginateRows(rows, limit);
  return {
    items: items.map((row) => ({
      id: row.id,
      type: row.type,
      note: row.note,
      from: canView(viewer, toPolicy(row.from), now).allowed
        ? { id: row.from.id, title: row.from.title, kind: row.from.kind, ownerId: row.from.ownerId }
        : null,
      to: canView(viewer, toPolicy(row.to), now).allowed
        ? { id: row.to.id, title: row.to.title, kind: row.to.kind, ownerId: row.to.ownerId }
        : null,
      createdByName: row.createdBy.name,
      createdAt: row.createdAt.toISOString(),
      source: row.source,
      confidence: row.confidence,
    })),
    nextCursor,
  };
}
