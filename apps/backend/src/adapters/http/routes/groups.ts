import { Router } from "express";
import { z } from "zod";
import { GroupView } from "contracts";
import { listGroups, toGroupView } from "../../../database-service/groups";

/**
 * GET /api/groups — every group, for any authenticated user (not admin-gated, unlike
 * `/api/admin/groups`). Feeds the "Groups" audience picker on `AccessPolicyEditor` so an
 * artifact owner can pick real group names instead of typing free text — mirrors what the MCP
 * `list_groups` tool already exposes to any authenticated caller.
 */
export function createGroupsRouter(): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const groups = await listGroups();
    res.json(z.array(GroupView).parse(groups.map(toGroupView)));
  });

  return router;
}
