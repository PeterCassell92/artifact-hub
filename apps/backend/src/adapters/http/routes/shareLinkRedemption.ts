import { Router } from "express";
import { canView } from "../../../core/authz";
import { ShareLinkRedemptionResponse } from "contracts";
import { findArtifactForDetail, toPolicy } from "../../../database-service/artifacts";
import { findActiveShareLinkByToken } from "../../../database-service/shareLinks";
import { recordAccessEvent } from "../../../database-service/accessEvents";
import { getEnv } from "../../../env";
import { sendError } from "../errors";

/**
 * GET /api/s/:token — share-link redemption (docs/architecture/03 §5). Never a bearer token
 * itself: resolves to an artifact id, then re-runs canView against the *current* policy, so a
 * previously-issued link goes dead the instant the owner revokes/narrows it. Redirects to the
 * frontend artifact-detail page (not straight to bytes) — the SPA's own download button then
 * calls GET /api/artifacts/:id/download for the presigned URL. Mounted under the authenticated
 * /api router (06 §4's "require auth" step is requireAuth("api"), same as every other route).
 *
 * Content-negotiated like GET /api/artifacts/:id/download: the SPA resolves this via `fetch`, not
 * a browser navigation, so it asks for `Accept: application/json` and gets `{ artifactId }` back.
 * A plain 302 doesn't work for a `fetch` caller here — once the redirect crosses the
 * backend->frontend origin boundary, the whole chain is CORS-tainted, so even the final hop
 * landing back on the frontend's own origin still needs an Access-Control-Allow-Origin header it
 * will never have. Direct/manual callers (browser address bar, curl, Bruno) keep the 302.
 */
export function createShareLinkRedemptionRouter(): Router {
  const router = Router();

  router.get("/:token", async (req, res) => {
    const link = await findActiveShareLinkByToken(req.params.token);
    if (!link) {
      sendError(res, 404, "not_found", "Share link not found");
      return;
    }

    const artifact = await findArtifactForDetail(link.artifactId);
    if (!artifact) {
      sendError(res, 404, "not_found", "Artifact not found");
      return;
    }

    const viewer = req.viewer!;
    const decision = canView(viewer, toPolicy(artifact), new Date());

    await recordAccessEvent({
      artifactId: artifact.id,
      userId: viewer.id,
      route: "share_link",
      action: "view",
      decision: decision.allowed ? "allowed" : "denied",
      denyReason: decision.reason,
      shareLinkId: link.id,
    });

    if (!decision.allowed) {
      sendError(res, 403, "forbidden", "This link no longer grants access", {
        reason: decision.reason,
      });
      return;
    }

    if (req.accepts(["html", "json"]) === "json") {
      res.json(ShareLinkRedemptionResponse.parse({ artifactId: artifact.id }));
      return;
    }

    const url = new URL(`/artifacts/${artifact.id}`, getEnv().APP_ORIGIN).toString();
    res.redirect(302, url);
  });

  return router;
}
