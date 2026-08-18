import { z } from "zod";

// Mirror of the Prisma enums (apps/backend/prisma/schema.prisma). Keep in sync.

export const Role = z.enum(["member", "admin"]);
export type Role = z.infer<typeof Role>;

export const UserStatus = z.enum(["invited", "active", "disabled"]);
export type UserStatus = z.infer<typeof UserStatus>;

export const AudienceType = z.enum([
  "public_authenticated",
  "specific_users",
  "user_groups",
]);
export type AudienceType = z.infer<typeof AudienceType>;

/** Expiry buckets exposed to users; map to an absolute timestamp server-side. */
export const ExpiryOption = z.enum(["24h", "7d", "30d", "never"]);
export type ExpiryOption = z.infer<typeof ExpiryOption>;

export const ArtifactKind = z.enum([
  "diagram",
  "document",
  "image",
  "report",
  "data",
  "other",
]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const InviteStatus = z.enum(["pending", "accepted", "expired", "revoked"]);
export type InviteStatus = z.infer<typeof InviteStatus>;

export const RelationType = z.enum([
  "supersedes",
  "derived_from",
  "related_to",
]);
export type RelationType = z.infer<typeof RelationType>;

/** `system` = a background job (e.g. artifact enrichment) reading content on the owner's behalf,
 * not a human or agent request — see docs/architecture/01 decision #46. */
export const AccessRoute = z.enum(["ui", "share_link", "mcp", "system"]);
export type AccessRoute = z.infer<typeof AccessRoute>;

export const AccessAction = z.enum(["view", "download"]);
export type AccessAction = z.infer<typeof AccessAction>;

export const AccessDecision = z.enum(["allowed", "denied"]);
export type AccessDecision = z.infer<typeof AccessDecision>;

export const EnrichmentStatus = z.enum(["pending", "running", "completed", "failed", "skipped"]);
export type EnrichmentStatus = z.infer<typeof EnrichmentStatus>;

/** Provenance of a tag or relationship — `ai` rows always carry a `confidence` score, `human`
 * rows never do. */
export const EnrichmentSource = z.enum(["human", "ai"]);
export type EnrichmentSource = z.infer<typeof EnrichmentSource>;
