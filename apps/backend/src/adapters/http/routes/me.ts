import { Router } from "express";
import { UserView } from "contracts";
import { findUserWithGroupsById, toUserView } from "../../../database-service/adminUsers";
import { sendError } from "../errors";

/**
 * GET /api/me — the SPA's "who am I" bootstrap (name/role/groups for the nav + admin-gating).
 * `requireAuth("api")` already guarantees `req.viewer` is an active, provisioned user by the time
 * this handler runs, so the only failure mode here is the row having vanished between the token
 * check and this query (mount races), which is a 404, not a fresh authz decision.
 */
export function createMeRouter(): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const user = await findUserWithGroupsById(req.viewer!.id);
    if (!user) {
      sendError(res, 404, "not_found", "User not found");
      return;
    }

    res.json(UserView.parse(toUserView(user)));
  });

  return router;
}
