import type { User } from "@prisma/client";
import type { Role, UserView } from "contracts";
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
  };
}

export function findUsersByEmails(emails: string[]): Promise<User[]> {
  return prisma.user.findMany({ where: { email: { in: emails } } });
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
