import { format, formatDistanceToNow } from "date-fns";
import type { ArtifactSummary, ExpiryOption } from "contracts";

export function formatPublishedAt(iso: string): string {
  return format(new Date(iso), "MMM d, yyyy");
}

/** Date + time — used where the exact publish moment matters (the artifact detail page's
 * metadata panel), since expiry buckets are computed relative to it (arch/03 §1), not just the
 * day. List rows and comments stay date-only via `formatPublishedAt`. */
export function formatPublishedAtWithTime(iso: string): string {
  return format(new Date(iso), "MMM d, yyyy 'at' h:mm a");
}

/** "expires in 3 days" / "expired 2 hours ago" / "never expires" — docs/frontend/01 §4. */
export function expiryLabel(artifact: Pick<ArtifactSummary, "expiresAt" | "isExpired">): string {
  if (!artifact.expiresAt) return "Never expires";
  const distance = formatDistanceToNow(new Date(artifact.expiresAt), { addSuffix: true });
  return artifact.isExpired ? `Expired ${distance}` : `Expires ${distance}`;
}

const EXPIRY_BUCKET_MS: Record<Exclude<ExpiryOption, "never">, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/** Mirrors the backend's `computeExpiresAt` (apps/backend/src/core/policy.ts): buckets are
 * relative to `publishedAt`, not "now". A client-side preview only — used to warn before Save,
 * never as an authoritative decision; the server always recomputes and enforces the real value. */
export function computeExpiresAtPreview(expiry: ExpiryOption, publishedAt: string): Date | null {
  if (expiry === "never") return null;
  return new Date(new Date(publishedAt).getTime() + EXPIRY_BUCKET_MS[expiry]);
}

/** Owner-facing artifact status (arch/03 §1a) — `revoked` (explicit instant cutoff) takes
 * priority over `isExpired` (the bucketed window naturally elapsing) so the two read distinctly. */
export function artifactStatusLabel(
  artifact: Pick<ArtifactSummary, "revoked" | "isExpired">,
): "Revoked" | "Expired" | "Accessible" {
  if (artifact.revoked) return "Revoked";
  if (artifact.isExpired) return "Expired";
  return "Accessible";
}

export function audienceLabel(audienceType: ArtifactSummary["audienceType"]): string {
  switch (audienceType) {
    case "public_authenticated":
      return "Anyone signed in";
    case "specific_users":
      return "Specific people";
    case "user_groups":
      return "Groups";
  }
}

export function kindLabel(kind: ArtifactSummary["kind"]): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** The actual file type (e.g. "JSON"), distinct from `kind`'s coarse publish-time category —
 * derived from `fileName`'s extension, falling back to the raw MIME `contentType` when there
 * isn't one. */
export function fileTypeLabel(artifact: Pick<ArtifactSummary, "fileName" | "contentType">): string {
  const extension = /\.([a-zA-Z0-9]+)$/.exec(artifact.fileName)?.[1];
  return extension ? extension.toUpperCase() : artifact.contentType;
}

export function sortLabel(sort: "published" | "title" | "lastAccessed" | "size"): string {
  switch (sort) {
    case "published":
      return "Newest first";
    case "title":
      return "Title (A–Z)";
    case "lastAccessed":
      return "Recently accessed";
    case "size":
      return "Size (largest first)";
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
