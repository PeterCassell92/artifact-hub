import { Router } from "express";
import { z } from "zod";
import {
  ChangeRoleInput,
  CorrectiveGroupChangeInput,
  CreateGroupInput,
  CreateInvitationInput,
  GroupView,
  InvitationView,
  UserView,
} from "contracts";
import type { InvitationWithInviter } from "../../../database-service/invitations";
import {
  changeRole,
  correctiveGroupChange,
  disableUser,
  isSafeToRemoveAdmin,
  listUsersWithGroups,
  toUserView,
} from "../../../database-service/adminUsers";
import {
  createGroup,
  findGroupsByIds,
  listGroups,
  toGroupView,
} from "../../../database-service/groups";
import { createInvitation, listInvitations } from "../../../database-service/invitations";
import { recordAdminAuditLog } from "../../../database-service/adminAuditLog";
import { sendError } from "../errors";

const IdParams = z.object({ id: z.string().uuid() });

async function toInvitationView(invitation: InvitationWithInviter): Promise<InvitationView> {
  const groups = await findGroupsByIds(invitation.groupIds);
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    groupNames: groups.map((g) => g.name),
    status: invitation.status,
    invitedByName: invitation.invitedBy.name,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  };
}

/** `/api/admin/*` (docs/architecture/06 §5) — mounted behind requireAuth("api") + requireAdmin(). */
export function createAdminRouter(): Router {
  const router = Router();

  router.get("/users", async (_req, res) => {
    const users = await listUsersWithGroups();
    res.json(z.array(UserView).parse(users.map(toUserView)));
  });

  // POST /api/admin/users/:id/groups — corrective, replaces the full group set (02 §7).
  router.post("/users/:id/groups", async (req, res) => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      sendError(res, 400, "bad_request", "Invalid user id");
      return;
    }
    const body = CorrectiveGroupChangeInput.safeParse(req.body);
    if (!body.success) {
      sendError(res, 400, "bad_request", "Invalid group change", body.error.flatten());
      return;
    }

    const groups = await findGroupsByIds(body.data.groupIds);
    if (groups.length !== body.data.groupIds.length) {
      sendError(res, 400, "bad_request", "One or more groupIds do not exist");
      return;
    }

    await correctiveGroupChange(params.data.id, body.data.groupIds);
    await recordAdminAuditLog({
      actorId: req.viewer!.id,
      action: "user.group_change",
      targetType: "user",
      targetId: params.data.id,
      metadata: { groupIds: body.data.groupIds },
    });

    res.status(204).end();
  });

  // POST /api/admin/users/:id/role — promote/demote; last-active-admin lock-out guard (02 §7).
  router.post("/users/:id/role", async (req, res) => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      sendError(res, 400, "bad_request", "Invalid user id");
      return;
    }
    const body = ChangeRoleInput.safeParse(req.body);
    if (!body.success) {
      sendError(res, 400, "bad_request", "Invalid role", body.error.flatten());
      return;
    }

    if (params.data.id === req.viewer!.id) {
      sendError(res, 409, "conflict", "Cannot change your own role");
      return;
    }

    if (body.data.role !== "admin" && !(await isSafeToRemoveAdmin(params.data.id))) {
      sendError(res, 409, "conflict", "Cannot demote the last remaining admin");
      return;
    }

    const before = await changeRole(params.data.id, body.data.role);
    await recordAdminAuditLog({
      actorId: req.viewer!.id,
      action: "role.change",
      targetType: "user",
      targetId: params.data.id,
      metadata: { before: before.role, after: body.data.role },
    });

    res.status(204).end();
  });

  // POST /api/admin/users/:id/disable — same lock-out guard as demote.
  router.post("/users/:id/disable", async (req, res) => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      sendError(res, 400, "bad_request", "Invalid user id");
      return;
    }

    if (params.data.id === req.viewer!.id) {
      sendError(res, 409, "conflict", "Cannot disable your own account");
      return;
    }

    if (!(await isSafeToRemoveAdmin(params.data.id))) {
      sendError(res, 409, "conflict", "Cannot disable the last remaining admin");
      return;
    }

    await disableUser(params.data.id);
    await recordAdminAuditLog({
      actorId: req.viewer!.id,
      action: "user.disable",
      targetType: "user",
      targetId: params.data.id,
    });

    res.status(204).end();
  });

  router.get("/groups", async (_req, res) => {
    const groups = await listGroups();
    res.json(z.array(GroupView).parse(groups.map(toGroupView)));
  });

  router.post("/groups", async (req, res) => {
    const body = CreateGroupInput.safeParse(req.body);
    if (!body.success) {
      sendError(res, 400, "bad_request", "Invalid group", body.error.flatten());
      return;
    }

    const group = await createGroup(body.data.name, body.data.description);
    res.status(201).json(GroupView.parse(toGroupView(group)));
  });

  router.get("/invitations", async (_req, res) => {
    const invitations = await listInvitations();
    res.json(z.array(InvitationView).parse(await Promise.all(invitations.map(toInvitationView))));
  });

  // POST /api/admin/invitations — creates the invite + enqueues its outbox send (02 §4/§6).
  // Draining the outbox (actually emailing it) is Phase 5; the raw token is never in this
  // response, matching "the raw token exists only in the emailed link" (docs/models/identity.md).
  router.post("/invitations", async (req, res) => {
    const body = CreateInvitationInput.safeParse(req.body);
    if (!body.success) {
      sendError(res, 400, "bad_request", "Invalid invitation", body.error.flatten());
      return;
    }

    const groups = await findGroupsByIds(body.data.groupIds);
    if (groups.length !== body.data.groupIds.length) {
      sendError(res, 400, "bad_request", "One or more groupIds do not exist");
      return;
    }

    const { invitation } = await createInvitation({
      email: body.data.email,
      name: body.data.name,
      role: body.data.role,
      groupIds: body.data.groupIds,
      invitedById: req.viewer!.id,
    });

    await recordAdminAuditLog({
      actorId: req.viewer!.id,
      action: "invite.create",
      targetType: "invitation",
      targetId: invitation.id,
      metadata: { email: invitation.email, role: invitation.role, groupIds: body.data.groupIds },
    });

    res.status(201).json(InvitationView.parse(await toInvitationView(invitation)));
  });

  return router;
}
