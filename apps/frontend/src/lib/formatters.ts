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
