import { Router, type Response } from "express";
import { z } from "zod";
import { ArtifactDetail, ArtifactListResponse, CommentView, MyArtifactsQuery } from "contracts";
import { canView } from "../../core/authz";
import { requireAuth } from "../../auth/tokenValidation";
import { findArtifactForDetail, listOwnedArtifacts, toDetail, toPolicy, toSummary } from "../../database-service/artifacts";
import { listComments } from "../../database-service/comments";
import { recordAccessEvent } from "../../database-service/accessEvents";
import { sendError } from "./errors";

const IdParams = z.object({ id: z.string().uuid() });

/** The /api/* surface (docs/architecture/06). Every route requires the API audience (§1). */
export function createApiRouter(): Router {
  const router = Router();
  router.use(requireAuth("api"));

  // GET /api/artifacts — "My Artifacts" (owner's own); see implementation-plan.md Phase 2 and
  // MyArtifactsQuery's own doc comment for why scope/facets beyond `mine` aren't supported yet.
  router.get("/artifacts", async (req, res) => {
    const parsed = MyArtifactsQuery.safeParse(req.query);
    if (!parsed.success) {
      sendError(res, 400, "bad_request", "Invalid query", parsed.error.flatten());
      return;
    }
    if (parsed.data.scope !== "mine") {
      sendError(res, 400, "bad_request", "Only scope=mine is supported currently");
      return;
    }

    const viewer = req.viewer!;
    const { items, nextCursor } = await listOwnedArtifacts(viewer.id, {
      limit: parsed.data.limit,
      cursor: parsed.data.cursor,
    });

    const now = new Date();
    res.json(ArtifactListResponse.parse({ items: items.map((a) => toSummary(a, now)), nextCursor }));
  });

  // GET /api/artifacts/:id — detail, gated by canView. Records an AccessEvent (allowed + denied).
  router.get("/artifacts/:id", async (req, res) => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      sendError(res, 400, "bad_request", "Invalid artifact id");
      return;
    }

    const artifact = await findArtifactForDetail(params.data.id);
    if (!artifact) {
      sendError(res, 404, "not_found", "Artifact not found");
      return;
    }

    const viewer = req.viewer!;
    const now = new Date();
    const decision = canView(viewer, toPolicy(artifact), now);

    await recordAccessEvent({
      artifactId: artifact.id,
      userId: viewer.id,
      route: "ui",
      action: "view",
      decision: decision.allowed ? "allowed" : "denied",
      denyReason: decision.reason,
    });

    if (!decision.allowed) {
      sendError(res, 403, "forbidden", "You do not have access to this artifact", {
        reason: decision.reason,
      });
      return;
    }

    res.json(ArtifactDetail.parse(toDetail(artifact, viewer.id, now)));
  });

  // GET /api/artifacts/:id/comments — gated by canView; no AccessEvent (only :id and
  // .../download write one — docs/architecture/06 §2).
  router.get("/artifacts/:id/comments", async (req, res) => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      sendError(res, 400, "bad_request", "Invalid artifact id");
      return;
    }

    const artifact = await findArtifactForDetail(params.data.id);
    if (!artifact) {
      sendError(res, 404, "not_found", "Artifact not found");
      return;
    }

    const viewer = req.viewer!;
    const decision = canView(viewer, toPolicy(artifact), new Date());
    if (!decision.allowed) {
      sendError(res, 403, "forbidden", "You do not have access to this artifact", {
        reason: decision.reason,
      });
      return;
    }

    const comments = await listComments(artifact.id);
    res.json(z.array(CommentView).parse(comments));
  });

  // Write/manage/admin/share-link routes land in Phase 3 (implementation-plan.md).
  const notImplemented = (_req: unknown, res: Response) =>
    sendError(res, 501, "internal", "Not implemented yet");

  router.get("/artifacts/:id/download", notImplemented);
  router.put("/artifacts/:id/policy", notImplemented);
  router.post("/artifacts/:id/comments", notImplemented);
  router.post("/artifacts/:id/share-links", notImplemented);

  return router;
}
