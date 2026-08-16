import type { ShareLink } from "@prisma/client";
import { prisma } from "../db";
import { generateToken, hashToken } from "../core/secureTokens";

export interface CreatedShareLink {
  id: string;
  token: string; // raw — returned once, never stored (docs/models/collaboration.md)
  revoked: boolean;
  createdAt: Date;
}

export async function createShareLink(
  artifactId: string,
  createdById: string,
): Promise<CreatedShareLink> {
  const token = generateToken();
  const link = await prisma.shareLink.create({
    data: { artifactId, createdById, tokenHash: hashToken(token) },
  });
  return { id: link.id, token, revoked: link.revoked, createdAt: link.createdAt };
}

/**
 * Resolves a redeemed token to its link. A revoked link fails to resolve at all — retiring a
 * link stops it from acting as a locator, regardless of what the artifact policy would otherwise
 * allow (docs/models/collaboration.md: "the artifact policy remains authoritative" refers to
 * *unrevoked* links; revocation is the one link-level override).
 */
export async function findActiveShareLinkByToken(token: string): Promise<ShareLink | null> {
  const link = await prisma.shareLink.findUnique({ where: { tokenHash: hashToken(token) } });
  return link && !link.revoked ? link : null;
}
