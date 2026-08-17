/**
 * The single authorization decision used by the API, MCP, and share-link paths.
 * Pure — no I/O — so it is exhaustively unit-tested (docs/architecture/03 + 09).
 */
import type { AudienceType, UserStatus } from "contracts";

export interface Viewer {
  id: string;
  status: UserStatus;
  groupIds: string[];
}

export interface ArtifactPolicy {
  ownerId: string;
  audienceType: AudienceType;
  expiresAt: Date | null; // null = never
  allowedUserIds: string[];
  allowedGroupIds: string[];
  // Owner-initiated instant cutoff — independent of expiresAt, so a naturally elapsed bucketed
  // expiry ("expired") stays distinguishable from an explicit "Revoke all access" ("revoked").
  revoked: boolean;
}

export type DenyReason = "disabled" | "expired" | "not_in_audience" | "revoked";

export interface Decision {
  allowed: boolean;
  reason?: DenyReason;
}

const ALLOW: Decision = { allowed: true };
const deny = (reason: DenyReason): Decision => ({ allowed: false, reason });

/** Can this viewer view/download the artifact right now? */
export function canView(
  viewer: Viewer,
  policy: ArtifactPolicy,
  now: Date,
): Decision {
  // Disabled users are blocked immediately (R4), even the owner.
  if (viewer.status === "disabled") return deny("disabled");

  // Owner always retains access — even after expiry or an explicit revoke ("My Artifacts"),
  // since they need to be able to see the artifact to re-open it.
  if (viewer.id === policy.ownerId) return ALLOW;

  if (policy.revoked) return deny("revoked");

  if (policy.expiresAt !== null && now >= policy.expiresAt) return deny("expired");

  switch (policy.audienceType) {
    case "public_authenticated":
      return ALLOW; // viewer is authenticated by definition
    case "specific_users":
      return policy.allowedUserIds.includes(viewer.id)
        ? ALLOW
        : deny("not_in_audience");
    case "user_groups":
      return viewer.groupIds.some((g) => policy.allowedGroupIds.includes(g))
        ? ALLOW
        : deny("not_in_audience");
  }
}

/** Commenting requires view permission (and an authenticated caller, always true here). */
export function canComment(
  viewer: Viewer,
  policy: ArtifactPolicy,
  now: Date,
): Decision {
  return canView(viewer, policy, now);
}

/** Only the (active) owner may change the access policy. */
export function canManagePolicy(viewer: Viewer, policy: ArtifactPolicy): boolean {
  return viewer.status !== "disabled" && viewer.id === policy.ownerId;
}

/** Minting a share link requires only view access, not ownership — a share link is a pure
 * locator (03 §5) that carries no standalone permission, so anyone who already passes `canView`
 * can safely hand the artifact's URL to someone else: the redeemer still has to pass `canView`
 * themselves on every redemption. */
export function canCreateShareLink(
  viewer: Viewer,
  policy: ArtifactPolicy,
  now: Date,
): Decision {
  return canView(viewer, policy, now);
}
