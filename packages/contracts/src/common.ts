import { z } from "zod";

/** Structured API error contract (see docs/architecture/06 §1). */
export const ApiErrorCode = z.enum([
  "bad_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "internal",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiError = z.object({
  error: z.object({
    code: ApiErrorCode,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

/** Cursor-paginated list envelope. */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

/** In-DOM notification message (frontend notifications slice; see frontend-patterns). */
export const NotificationKind = z.enum(["success", "error", "info"]);
export type NotificationKind = z.infer<typeof NotificationKind>;
