import type { CommentView } from "contracts";
import { prisma } from "../db";

/** Comments on an artifact, oldest first (docs/architecture/03 §9). */
export async function listComments(artifactId: string): Promise<CommentView[]> {
  const rows = await prisma.comment.findMany({
    where: { artifactId },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { name: true } } },
  });

  return rows.map((c) => ({
    id: c.id,
    authorName: c.author.name ?? "Unknown",
    body: c.body,
    createdAt: c.createdAt.toISOString(),
  }));
}

/** Attributed to the caller; requires canView + authenticated (docs/architecture/03 §9). */
export async function createComment(
  artifactId: string,
  authorId: string,
  body: string,
): Promise<CommentView> {
  const comment = await prisma.comment.create({
    data: { artifactId, authorId, body },
    include: { author: { select: { name: true } } },
  });

  return {
    id: comment.id,
    authorName: comment.author.name ?? "Unknown",
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
  };
}
