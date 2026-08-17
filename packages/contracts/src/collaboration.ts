import { z } from "zod";

/** A comment as shown in the UI/MCP (body, author name, date). */
export const CommentView = z.object({
  id: z.string().uuid(),
  authorName: z.string(),
  body: z.string(),
  createdAt: z.string().datetime(),
});
export type CommentView = z.infer<typeof CommentView>;

export const CreateCommentInput = z.object({
  body: z.string().min(1).max(10_000),
});
export type CreateCommentInput = z.infer<typeof CreateCommentInput>;

export const ShareLinkView = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  revoked: z.boolean(),
  createdAt: z.string().datetime(),
});
export type ShareLinkView = z.infer<typeof ShareLinkView>;

/** GET /api/s/:token JSON body (Accept: application/json) — mirrors DownloadUrlResponse's
 * content-negotiation pattern so SPA `fetch` callers avoid a cross-origin redirect chain. */
export const ShareLinkRedemptionResponse = z.object({
  artifactId: z.string().uuid(),
});
export type ShareLinkRedemptionResponse = z.infer<typeof ShareLinkRedemptionResponse>;
