import { z } from "zod";
import { InviteStatus, Role, UserStatus } from "./enums";

/** Admin view of a user (admin/users list). */
export const UserView = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: Role,
  status: UserStatus,
  groupNames: z.array(z.string()),
});
export type UserView = z.infer<typeof UserView>;

/** Admin invites a user (email + role + group(s)). Name is optional — set on the placeholder
 * user record immediately, so it shows up in the users list before the invitee accepts. */
export const CreateInvitationInput = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).optional(),
  role: Role.default("member"),
  groupIds: z.array(z.string().uuid()).default([]),
});
export type CreateInvitationInput = z.infer<typeof CreateInvitationInput>;

/** Promote/demote an existing user. */
export const ChangeRoleInput = z.object({
  role: Role,
});
export type ChangeRoleInput = z.infer<typeof ChangeRoleInput>;

/** Corrective, admin-only group reassignment (docs/architecture/02 §3) — replaces the full set. */
export const CorrectiveGroupChangeInput = z.object({
  groupIds: z.array(z.string().uuid()),
});
export type CorrectiveGroupChangeInput = z.infer<typeof CorrectiveGroupChangeInput>;

/** Admin view of a group. */
export const GroupView = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type GroupView = z.infer<typeof GroupView>;

export const CreateGroupInput = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});
export type CreateGroupInput = z.infer<typeof CreateGroupInput>;

/** Admin view of an invitation (admin/users invite list). */
export const InvitationView = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: Role,
  groupNames: z.array(z.string()),
  status: InviteStatus,
  invitedByName: z.string().nullable(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type InvitationView = z.infer<typeof InvitationView>;

/** GET /api/invitations/:token — unauthenticated preview for the invitee (06 §6). */
export const InvitationPreview = z.object({
  email: z.string().email(),
  role: Role,
  groupNames: z.array(z.string()),
});
export type InvitationPreview = z.infer<typeof InvitationPreview>;

/** POST /api/invitations/accept — the invite token is the only required input (02 §4). */
export const AcceptInvitationInput = z.object({
  token: z.string().min(1),
});
export type AcceptInvitationInput = z.infer<typeof AcceptInvitationInput>;
