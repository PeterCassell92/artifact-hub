import { Prisma } from "@prisma/client";
import type { ArtifactRelationshipInput, ArtifactRelationshipSummary, RelationType } from "contracts";
import { prisma } from "../db";
import { canManagePolicy, canView, type Viewer } from "../core/authz";
import { findArtifactForDetail, toPolicy } from "./artifacts";

export type CreateRelationshipResult =
  | { ok: true; relationshipId: string; createdAt: Date }
  | {
      ok: false;
      toId: string;
      type: RelationType;
      reason: "self_link" | "to_not_found" | "to_not_viewable" | "duplicate";
    };

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
      data: { fromId, toId: input.toId, type: input.type, note: input.note, createdById: linker.id },
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
    };
  });
}
