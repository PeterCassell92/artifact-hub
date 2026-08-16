import type { Response } from "express";
import type { ApiErrorCode } from "contracts";

/** The structured error contract (docs/architecture/06 §1). */
export function sendError(
  res: Response,
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): void {
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}
