import { Router } from "express";
import { AcceptInvitationInput, InvitationPreview } from "contracts";
import { acceptInvitation, findInvitationByToken, isInvitationUsable } from "../../../database-service/invitations";
import { findGroupsByIds } from "../../../database-service/groups";
import { recordAdminAuditLog } from "../../../database-service/adminAuditLog";
import { sendError } from "../errors";

/**
 * GET /api/invitations/:token + POST /api/invitations/accept (docs/architecture/06 §6) —
 * unauthenticated bootstrap: the invitee has no account yet, so this router is mounted OUTSIDE
 * requireAuth("api") (see app.ts), unlike everything else under /api.
 */
export function createInvitationsPublicRouter(): Router {
  const router = Router();

  router.get("/:token", async (req, res) => {
    const invitation = await findInvitationByToken(req.params.token);
    if (!invitation || !isInvitationUsable(invitation, new Date())) {
      sendError(res, 404, "not_found", "Invitation not found or no longer valid");
      return;
    }

    const groups = await findGroupsByIds(invitation.groupIds);
    res.json(
      InvitationPreview.parse({
        email: invitation.email,
        role: invitation.role,
        groupNames: groups.map((g) => g.name),
      }),
    );
  });

  router.post("/accept", async (req, res) => {
    const body = AcceptInvitationInput.safeParse(req.body);
    if (!body.success) {
      sendError(res, 400, "bad_request", "Invalid request", body.error.flatten());
      return;
    }

    const invitation = await findInvitationByToken(body.data.token);
    if (!invitation || !isInvitationUsable(invitation, new Date())) {
      sendError(res, 404, "not_found", "Invitation not found or no longer valid");
      return;
    }

    const user = await acceptInvitation(invitation);

    await recordAdminAuditLog({
      actorId: null, // the invitee has no account yet at the moment of accept
      action: "invitation.accept",
      targetType: "invitation",
      targetId: invitation.id,
      metadata: { userId: user.id, email: user.email, role: user.role, groupIds: invitation.groupIds },
    });

    res.status(204).end();
  });

  return router;
}
