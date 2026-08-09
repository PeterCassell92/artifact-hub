import { Router } from "express";

/**
 * The /api/* surface (docs/architecture/06). Placeholder — routes return 501 until
 * implemented. NOTE: publishing is MCP-only; there is no UI publish route here beyond the
 * create/finalize endpoints that back the MCP publish path.
 */
export function createApiRouter(): Router {
  const router = Router();

  const notImplemented = (_req: unknown, res: import("express").Response) =>
    res.status(501).json({
      error: { code: "internal", message: "Not implemented yet" },
    });

  // Artifacts (view/manage; see 06 §2)
  router.get("/artifacts", notImplemented);
  router.get("/artifacts/:id", notImplemented);
  router.get("/artifacts/:id/download", notImplemented);
  router.put("/artifacts/:id/policy", notImplemented); // revocation
  router.get("/artifacts/:id/comments", notImplemented);
  router.post("/artifacts/:id/comments", notImplemented);
  router.post("/artifacts/:id/share-links", notImplemented);

  // Share-link redemption (06 §4) + admin (06 §5) added during implementation.

  return router;
}
