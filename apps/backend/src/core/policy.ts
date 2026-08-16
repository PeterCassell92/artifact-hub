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
