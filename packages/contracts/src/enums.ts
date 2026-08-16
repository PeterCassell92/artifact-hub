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

export const AccessRoute = z.enum(["ui", "share_link", "mcp"]);
export type AccessRoute = z.infer<typeof AccessRoute>;

export const AccessAction = z.enum(["view", "download"]);
export type AccessAction = z.infer<typeof AccessAction>;

export const AccessDecision = z.enum(["allowed", "denied"]);
export type AccessDecision = z.infer<typeof AccessDecision>;
