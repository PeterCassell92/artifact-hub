import type { CommentView } from "contracts";
import { prisma } from "../db";
import { enqueueOutboxEvent } from "./outbox";
import { logger } from "../logger";

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

/** Distinct commenters so far, for the "new comment" notification recipient set — read before the
 * new comment is inserted so it naturally excludes the one being created. */
export function listDistinctCommentAuthorIds(artifactId: string): Promise<string[]> {
  return prisma.comment
    .findMany({ where: { artifactId }, distinct: ["authorId"], select: { authorId: true } })
    .then((rows) => rows.map((r) => r.authorId));
}

/**
 * Attributed to the caller; requires canView + authenticated (docs/architecture/03 §9). Notifies
 * the artifact owner + prior distinct commenters (excluding the new commenter) — one
 * "artifact.new_comment" outbox row per active recipient, enqueued in the same transaction as the
 * comment (docs/architecture/02 §6 transactional-outbox pattern).
 */
export async function createComment(
  artifactId: string,
  authorId: string,
  body: string,
  ownerId: string,
): Promise<CommentView> {
  const priorAuthorIds = await listDistinctCommentAuthorIds(artifactId);
  const recipientIds = new Set([ownerId, ...priorAuthorIds]);
  recipientIds.delete(authorId);

  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: { artifactId, authorId, body },
      include: { author: { select: { name: true } } },
    });

    if (recipientIds.size > 0) {
      const recipients = await tx.user.findMany({
        where: { id: { in: [...recipientIds] }, status: "active" },
        select: { id: true, email: true, name: true },
      });
      for (const recipient of recipients) {
        await enqueueOutboxEvent(
          {
            type: "artifact.new_comment",
            payload: {
              artifactId,
              commentId: created.id,
              recipientUserId: recipient.id,
              recipientEmail: recipient.email,
              recipientName: recipient.name,
              commenterName: created.author.name ?? "Someone",
            },
            idempotencyKey: `artifact-new-comment:${created.id}:${recipient.id}`,
          },
          tx,
        );
      }
      logger.info(
        { artifactId, commentId: created.id, recipientCount: recipients.length },
        "enqueued new-comment notifications",
      );
    }

    return created;
  });

  return {
    id: comment.id,
    authorName: comment.author.name ?? "Unknown",
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
  };
}
