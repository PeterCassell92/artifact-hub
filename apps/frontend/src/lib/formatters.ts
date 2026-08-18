import { format, formatDistanceToNow } from "date-fns";
import type {
  AccessEventView,
  ArtifactRelationshipSummary,
  ArtifactSummary,
  AudienceType,
  EnrichmentStatus,
  ExpiryOption,
} from "contracts";

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

/** Shared by AccessPolicyEditor (edit) and PublishArtifactModal (create) — an audience of
 * specific_users/user_groups with nobody actually picked is never a valid submission, in either
 * flow, so both gate on the same predicate rather than risking the rule drifting apart.
 * `userEmails` is a selection (from the "Specific people" combo box, PublicUserView-backed), not
 * free text — see AccessPolicyFields. */
export function audiencePolicyMissing(
  audienceType: AudienceType,
  userEmails: string[],
  groupNames: string[],
): { emailsMissing: boolean; groupsMissing: boolean } {
  return {
    emailsMissing: audienceType === "specific_users" && userEmails.length === 0,
    groupsMissing: audienceType === "user_groups" && groupNames.length === 0,
  };
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

/** `type` is stored as `from -> to`; a viewer on the `incoming` side reads the inverse relation
 * (e.g. "X supersedes this" reads as "Superseded by X", not "Supersedes X"). `related_to` is
 * symmetric, so both directions read the same. */
const RELATIONSHIP_LABELS: Record<ArtifactRelationshipSummary["type"], { outgoing: string; incoming: string }> = {
  supersedes: { outgoing: "Supersedes", incoming: "Superseded by" },
  derived_from: { outgoing: "Derived from", incoming: "Source for" },
  related_to: { outgoing: "Related to", incoming: "Related to" },
};

export function relationshipLabel(
  relationship: Pick<ArtifactRelationshipSummary, "type" | "direction">,
): string {
  return RELATIONSHIP_LABELS[relationship.type][relationship.direction];
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

export function accessActionLabel(action: AccessEventView["action"]): string {
  return action === "download" ? "Downloaded" : "Viewed";
}

export function accessRouteLabel(route: AccessEventView["route"]): string {
  switch (route) {
    case "ui":
      return "Web";
    case "share_link":
      return "Share link";
    case "mcp":
      return "Agent";
    case "system":
      return "AI enrichment";
  }
}

const DENY_REASON_LABELS: Record<string, string> = {
  disabled: "account disabled",
  expired: "access expired",
  not_in_audience: "not in audience",
  revoked: "access revoked",
};

/** Falls back to the raw reason string for any value not in the map, rather than hiding it —
 * denyReason is a narrow backend-defined set (core/authz.ts DenyReason) but isn't a shared
 * contracts enum, so this stays defensive. */
export function accessDenyReasonLabel(denyReason: string | undefined): string {
  if (!denyReason) return "denied";
  return DENY_REASON_LABELS[denyReason] ?? denyReason;
}

export function enrichmentStatusLabel(status: EnrichmentStatus): string {
  switch (status) {
    case "pending":
      return "Queued";
    case "running":
      return "Analyzing…";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "skipped":
      return "Not applicable";
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
