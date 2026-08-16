import { format, formatDistanceToNow } from "date-fns";
import type { ArtifactSummary } from "contracts";

export function formatPublishedAt(iso: string): string {
  return format(new Date(iso), "MMM d, yyyy");
}

/** "expires in 3 days" / "expired 2 hours ago" / "never expires" — docs/frontend/01 §4. */
export function expiryLabel(artifact: Pick<ArtifactSummary, "expiresAt" | "isExpired">): string {
  if (!artifact.expiresAt) return "Never expires";
  const distance = formatDistanceToNow(new Date(artifact.expiresAt), { addSuffix: true });
  return artifact.isExpired ? `Expired ${distance}` : `Expires ${distance}`;
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
