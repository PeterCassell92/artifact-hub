import { Router } from "express";
import { z } from "zod";
import { PublicUserView } from "contracts";
import { listActiveUsers, toPublicUserView } from "../../../database-service/adminUsers";

/**
 * GET /api/users — every active user (trimmed, non-admin view), for any authenticated user
 * (not admin-gated, unlike `/api/admin/users`). Feeds the "Specific people" audience picker on
 * AccessPolicyFields so an artifact owner can select real emails instead of typing free text —
 * mirrors `/api/groups`'s role for the "Groups" picker.
 */
export function createUsersRouter(): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const users = await listActiveUsers();
    res.json(z.array(PublicUserView).parse(users.map(toPublicUserView)));
  });

  return router;
}
