import type { User } from "@prisma/client";
import type { PublicUserView, Role, UserView } from "contracts";
import { prisma } from "../db";

const withGroups = { include: { memberships: { include: { group: true } } } } as const;
type UserWithGroups = User & { memberships: { group: { name: string } }[] };

export async function listUsersWithGroups(): Promise<UserWithGroups[]> {
  return prisma.user.findMany({ orderBy: { createdAt: "desc" }, ...withGroups });
}

/** Single-row lookup for GET /api/me — the SPA's "who am I" bootstrap. */
export function findUserWithGroupsById(id: string): Promise<UserWithGroups | null> {
  return prisma.user.findUnique({ where: { id }, ...withGroups });
}

export function toUserView(user: UserWithGroups): UserView {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    groupNames: user.memberships.map((m) => m.group.name),
    createdAt: user.createdAt.toISOString(),
  };
}

export function findUsersByEmails(emails: string[]): Promise<User[]> {
  return prisma.user.findMany({ where: { email: { in: emails } } });
}

/** Active users by id — the `specific_users` branch of resolving a policy to concrete recipients
 * (database-service/artifactRecipients.ts). */
export function findUsersByIds(ids: string[]): Promise<User[]> {
  return prisma.user.findMany({ where: { id: { in: ids }, status: "active" } });
}

/** Reverse of the usual user -> groups direction (e.g. `Viewer.groupIds`): active users belonging
 * to any of the given groups — the `user_groups` branch of resolving a policy to concrete
 * recipients (database-service/artifactRecipients.ts). `findMany` with `some` naturally dedupes a
 * user who qualifies via more than one group. */
export function findUsersInGroups(groupIds: string[]): Promise<User[]> {
  return prisma.user.findMany({
    where: { status: "active", memberships: { some: { groupId: { in: groupIds } } } },
  });
}

/** Every active user — the `public_authenticated` branch of resolving a policy to concrete
 * recipients (database-service/artifactRecipients.ts), and the source list for GET /api/users
 * (the "Specific people" audience picker). */
export function listActiveUsers(): Promise<User[]> {
  return prisma.user.findMany({ where: { status: "active" }, orderBy: { email: "asc" } });
}

export function toPublicUserView(user: User): PublicUserView {
  return { id: user.id, email: user.email, name: user.name };
}

/** Every user requires a display name (schema.prisma `User.name`, NOT NULL) — this derives a
 * reasonable placeholder from an email's local-part (e.g. "peter.cassell@x.com" -> "Peter
 * Cassell") for the rare paths with no admin-provided name to fall back to (the defensive
 * upsert-create branch in `acceptInvitation`). Mirrors the migration's own SQL backfill. */
export function nameFromEmail(email: string): string {
  const localPart = email.split("@")[0] ?? email;
  return localPart
    .replace(/[._]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Guards the "last remaining admin" lock-out (docs/architecture/02 §7): false means the given
 * user is the sole active admin, so demoting/disabling them must be refused.
 */
export async function isSafeToRemoveAdmin(userId: string): Promise<boolean> {
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.role !== "admin" || target.status !== "active") return true;

  const activeAdminCount = await prisma.user.count({ where: { role: "admin", status: "active" } });
  return activeAdminCount > 1;
}

export function changeRole(userId: string, role: Role): Promise<User> {
  return prisma.user.update({ where: { id: userId }, data: { role } });
}

export function disableUser(userId: string): Promise<User> {
  return prisma.user.update({ where: { id: userId }, data: { status: "disabled" } });
}

/** Corrective, admin-only — replaces the user's full group set (docs/architecture/02 §3). */
export async function correctiveGroupChange(userId: string, groupIds: string[]): Promise<void> {
  await prisma.$transaction([
    prisma.groupMembership.deleteMany({ where: { userId } }),
    ...groupIds.map((groupId) => prisma.groupMembership.create({ data: { userId, groupId } })),
  ]);
}
