import { createHash, randomBytes } from "node:crypto";

/**
 * Shared locator-token scheme for share links and invitations (docs/architecture/02 §4, 03 §5):
 * the raw token is handed to the user once (URL/email); only its hash is ever stored.
 */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
