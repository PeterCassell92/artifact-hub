import { Router } from "express";
import { requireAdmin, requireAuth } from "../../auth/tokenValidation";
import { createArtifactsRouter } from "./routes/artifacts";
import { createGroupsRouter } from "./routes/groups";
import { createShareLinkRedemptionRouter } from "./routes/shareLinkRedemption";
import { createAdminRouter } from "./routes/admin";
import { createMeRouter } from "./routes/me";

/**
 * The authenticated /api/* surface (docs/architecture/06). Every route requires the API
 * audience (§1); `/admin/*` additionally requires role=admin (§5, R3). The unauthenticated
 * invitation-bootstrap routes (§6) are NOT here — see routes/invitationsPublic.ts, mounted
 * directly on the app outside this router (app.ts).
 */
export function createApiRouter(): Router {
  const router = Router();
  router.use(requireAuth("api"));

  router.use("/artifacts", createArtifactsRouter());
  router.use("/groups", createGroupsRouter());
  router.use("/s", createShareLinkRedemptionRouter());
  router.use("/admin", requireAdmin(), createAdminRouter());
  router.use("/me", createMeRouter());

  return router;
}
