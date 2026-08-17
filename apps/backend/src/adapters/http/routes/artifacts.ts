import { Router } from "express";
import { z } from "zod";
import {
  AccessPolicyInput,
  ArtifactDetail,
  ArtifactFacetOptions,
  ArtifactListQuery,
  ArtifactListResponse,
  CommentView,
  CreateCommentInput,
  DownloadUrlResponse,
  ShareLinkView,
} from "contracts";
import { canCreateShareLink, canManagePolicy, canView } from "../../../core/authz";
import { computeExpiresAt } from "../../../core/policy";
import {
  checkViewAndAudit,
  findArtifactForDetail,
  getArtifactFacets,
  listOwnedArtifacts,
  listSharedWithMe,
  resolveAudienceInput,
  revokeArtifactAccess,
  toDetail,
  toPolicy,
  toSummary,
  updateArtifactPolicy,
} from "../../../database-service/artifacts";
import { buildAccessRevokedOutboxEvents, buildNewAccessOutboxEvents } from "../../../database-service/artifactRecipients";
import { createComment, listComments } from "../../../database-service/comments";
import { recordAdminAuditLog } from "../../../database-service/adminAuditLog";
import { createShareLink } from "../../../database-service/shareLinks";
import { getPresignedDownloadUrl } from "../../../storage/s3";
import { getEnv } from "../../../env";
import { sendError } from "../errors";

const IdParams = z.object({ id: z.string().uuid() });

export function createArtifactsRouter(): Router {
  const router = Router();

  // GET /api/artifacts — "My Artifacts" (owner's own) + "Shared With Me", with the full
  // search/facet/sort surface (implementation-plan.md Phase 7, docs/frontend/02). Filters that
  // don't apply to the current scope (see ArtifactListQuery's doc comment) are silently ignored
  // by the DAL rather than rejected, so one control set works for both pages.
  router.get("/", async (req, res) => {
    const parsed = ArtifactListQuery.safeParse(req.query);
    if (!parsed.success) {
      sendError(res, 400, "bad_request", "Invalid query", parsed.error.flatten());
      return;
    }

    const viewer = req.viewer!;
    const { scope, cursor, limit, ...filters } = parsed.data;
    const { items, nextCursor } =
      scope === "mine"
        ? await listOwnedArtifacts(viewer.id, { ...filters, limit, cursor })
        : await listSharedWithMe(viewer, { ...filters, limit, cursor });

    const now = new Date();
    res.json(ArtifactListResponse.parse({ items: items.map((a) => toSummary(a, now)), nextCursor }));
  });

  // GET /api/artifacts/facets — distinct filter values the caller can actually use, for
  // populating the frontend's multi-select controls (Phase 7, docs/frontend/02 §2).
  router.get("/facets", async (req, res) => {
    const parsed = z.object({ scope: z.enum(["mine", "sharedWithMe"]).default("mine") }).safeParse(req.query);
    if (!parsed.success) {
      sendError(res, 400, "bad_request", "Invalid query", parsed.error.flatten());
      return;
    }

    const facets = await getArtifactFacets(req.viewer!, parsed.data.scope);
    res.json(ArtifactFacetOptions.parse(facets));
  });

  // GET /api/artifacts/:id — detail, gated by canView. Records an AccessEvent (allowed + denied).
  router.get("/:id", async (req, res) => {
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
    const decision = await checkViewAndAudit(viewer, artifact, "ui", "view");

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
  router.get("/:id/comments", async (req, res) => {
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

  // POST /api/artifacts/:id/comments — canComment = canView + authenticated (always true here).
  router.post("/:id/comments", async (req, res) => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      sendError(res, 400, "bad_request", "Invalid artifact id");
      return;
    }

    const body = CreateCommentInput.safeParse(req.body);
    if (!body.success) {
      sendError(res, 400, "bad_request", "Invalid comment body", body.error.flatten());
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

    const comment = await createComment(artifact.id, viewer.id, body.data.body, artifact.ownerId);
    res.status(201).json(CommentView.parse(comment));
  });

  // PUT /api/artifacts/:id/policy — revocation is just re-writing the policy (03 §4).
  // Owner-only (canManagePolicy); audit-logged (policy.update).
  router.put("/:id/policy", async (req, res) => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      sendError(res, 400, "bad_request", "Invalid artifact id");
      return;
    }

    const body = AccessPolicyInput.safeParse(req.body);
    if (!body.success) {
      sendError(res, 400, "bad_request", "Invalid policy", body.error.flatten());
      return;
    }

    const artifact = await findArtifactForDetail(params.data.id);
    if (!artifact) {
      sendError(res, 404, "not_found", "Artifact not found");
      return;
    }

    const viewer = req.viewer!;
    const before = toPolicy(artifact);
    if (!canManagePolicy(viewer, before)) {
      sendError(res, 403, "forbidden", "Only the owner can manage this artifact's policy");
      return;
    }

    const resolved = await resolveAudienceInput(body.data);
    if (!resolved.ok) {
      sendError(res, 400, "bad_request", resolved.error, resolved.details);
      return;
    }

    const now = new Date();
    // Relative to publishedAt (createdAt), not this edit — a "7 days" window is a fixed deadline
    // set at publish time, not something that silently resets every time the owner tweaks the
    // audience without touching expiry. Can land in the past — that's the normal, allowed way to
    // narrow a policy into non-access (03 §4), same as picking a past expiry always was.
    const expiresAt = computeExpiresAt(body.data.expiry, artifact.createdAt);

    const newAccessOutboxEvents = await buildNewAccessOutboxEvents(
      { id: artifact.id, ownerId: artifact.ownerId },
      before,
      { audienceType: resolved.audienceType, allowedUserIds: resolved.allowedUserIds, allowedGroupIds: resolved.allowedGroupIds },
    );

    await updateArtifactPolicy(
      artifact.id,
      {
        audienceType: resolved.audienceType,
        expiresAt,
        allowedUserIds: resolved.allowedUserIds,
        allowedGroupIds: resolved.allowedGroupIds,
        updatedById: viewer.id,
      },
      newAccessOutboxEvents,
    );

    await recordAdminAuditLog({
      actorId: viewer.id,
      action: "policy.update",
      targetType: "artifact",
      targetId: artifact.id,
      metadata: {
        before,
        after: {
          audienceType: resolved.audienceType,
          expiresAt,
          allowedUserIds: resolved.allowedUserIds,
          allowedGroupIds: resolved.allowedGroupIds,
        },
      },
    });
    req.log.info(
      { userId: viewer.id, artifactId: artifact.id, newAccessCount: newAccessOutboxEvents.length },
      "policy.update",
    );

    const updated = await findArtifactForDetail(artifact.id);
    res.json(ArtifactDetail.parse(toDetail(updated!, viewer.id, now)));
  });

  // POST /api/artifacts/:id/revoke — explicit instant cutoff (03 §1a), independent of
  // audienceType/expiresAt (left untouched, so the owner sees the prior policy again once they
  // re-open it). Owner-only (canManagePolicy); audit-logged (policy.revoke). Saving a fresh
  // policy via PUT .../policy is what clears it back — see updateArtifactPolicy.
  router.post("/:id/revoke", async (req, res) => {
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
    if (!canManagePolicy(viewer, toPolicy(artifact))) {
      sendError(res, 403, "forbidden", "Only the owner can revoke this artifact's access");
      return;
    }

    const outboxEvents = await buildAccessRevokedOutboxEvents(
      { id: artifact.id, ownerId: artifact.ownerId },
      toPolicy(artifact),
    );
    await revokeArtifactAccess(artifact.id, viewer.id, outboxEvents);

    await recordAdminAuditLog({
      actorId: viewer.id,
      action: "policy.revoke",
      targetType: "artifact",
      targetId: artifact.id,
      metadata: {},
    });
    req.log.info(
      { userId: viewer.id, artifactId: artifact.id, revokedCount: outboxEvents.length },
      "policy.revoke",
    );

    const updated = await findArtifactForDetail(artifact.id);
    res.json(ArtifactDetail.parse(toDetail(updated!, viewer.id, new Date())));
  });

  // POST /api/artifacts/:id/share-links — anyone who can view the artifact; pure locator (03 §5),
  // audit-logged. Safe for a non-owner: the link carries no permission of its own, so whoever
  // redeems it still has to pass canView themselves on every redemption.
  router.post("/:id/share-links", async (req, res) => {
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
    if (!canCreateShareLink(viewer, toPolicy(artifact), new Date()).allowed) {
      sendError(res, 403, "forbidden", "You do not have access to this artifact");
      return;
    }

    const link = await createShareLink(artifact.id, viewer.id);

    await recordAdminAuditLog({
      actorId: viewer.id,
      action: "share_link.create",
      targetType: "artifact",
      targetId: artifact.id,
      metadata: { shareLinkId: link.id },
    });
    req.log.info({ userId: viewer.id, artifactId: artifact.id, shareLinkId: link.id }, "share_link.create");

    const url = new URL(`/s/${link.token}`, getEnv().APP_ORIGIN).toString();
    res.status(201).json(
      ShareLinkView.parse({ id: link.id, url, revoked: link.revoked, createdAt: link.createdAt.toISOString() }),
    );
  });

  // GET /api/artifacts/:id/download — presigned GET, browser path only (03 §6). Records an
  // AccessEvent (allowed + denied), like the detail route.
  router.get("/:id/download", async (req, res) => {
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
    const decision = await checkViewAndAudit(viewer, artifact, "ui", "download");

    if (!decision.allowed) {
      sendError(res, 403, "forbidden", "You do not have access to this artifact", {
        reason: decision.reason,
      });
      return;
    }

    const url = await getPresignedDownloadUrl(artifact.storageKey, {
      contentType: artifact.contentType,
      fileName: artifact.fileName,
    });

    // The SPA asks for JSON (it uses the URL as a plain <iframe>/<img>/<a> target, not via
    // fetch-follow-redirect — the redirect's final hop is Tigris, a third origin with no CORS
    // configured). Direct/manual callers (curl, Bruno, an absent/`*/*` Accept header) keep the
    // original 302 — "html" listed first so a wildcard Accept matches it, not "json".
    if (req.accepts(["html", "json"]) === "json") {
      res.json(DownloadUrlResponse.parse({ url }));
      return;
    }

    res.redirect(302, url);
  });

  return router;
}
