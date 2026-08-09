import { z } from "zod";
import { Role, UserStatus } from "./enums.js";

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

/** Admin invites a user (email + role + group(s)). */
export const CreateInvitationInput = z.object({
  email: z.string().email(),
  role: Role.default("member"),
  groupIds: z.array(z.string().uuid()).default([]),
});
export type CreateInvitationInput = z.infer<typeof CreateInvitationInput>;

/** Promote/demote an existing user. */
export const ChangeRoleInput = z.object({
  role: Role,
});
export type ChangeRoleInput = z.infer<typeof ChangeRoleInput>;
