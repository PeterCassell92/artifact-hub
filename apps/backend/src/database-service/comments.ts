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
