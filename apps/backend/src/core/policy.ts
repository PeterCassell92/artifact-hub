/**
 * Expiry-bucket → absolute-timestamp computation (docs/architecture/03 §1). Pure — no I/O — so
 * it is exhaustively unit-tested alongside authz.ts (docs/architecture/09 §2).
 */
import type { ExpiryOption } from "contracts";

const BUCKET_MS: Record<Exclude<ExpiryOption, "never">, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/** `never` -> null (no expiry); otherwise `now + bucket`. */
export function computeExpiresAt(expiry: ExpiryOption, now: Date): Date | null {
  if (expiry === "never") return null;
  return new Date(now.getTime() + BUCKET_MS[expiry]);
}

/** Ids present in `after` but not `before` — "who newly gained access" when a policy is saved
 * (database-service/artifactRecipients.ts). Operates on already-resolved recipient-id lists;
 * resolving a policy to concrete ids is I/O and lives in the database-service layer. */
export function newlyGrantedIds(before: string[], after: string[]): string[] {
  const beforeSet = new Set(before);
  return after.filter((id) => !beforeSet.has(id));
}
