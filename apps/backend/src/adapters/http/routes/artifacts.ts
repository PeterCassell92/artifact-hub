import { Router } from "express";
import { z } from "zod";
import {
  AccessPolicyInput,
  ArtifactDetail,
  ArtifactListResponse,
  CommentView,
  CreateCommentInput,
  MyArtifactsQuery,
  ShareLinkView,
} from "contracts";
import { canManagePolicy, canView } from "../../../core/authz";
import { computeExpiresAt } from "../../../core/policy";
import {
  checkViewAndAudit,
  findArtifactForDetail,
  listOwnedArtifacts,
  resolveAudienceInput,
  toDetail,
  toPolicy,
  toSummary,
  updateArtifactPolicy,
} from "../../../database-service/artifacts";
import { createComment, listComments } from "../../../database-service/comments";
import { recordAdminAuditLog } from "../../../database-service/adminAuditLog";
import { createShareLink } from "../../../database-service/shareLinks";
import { getPresignedDownloadUrl } from "../../../storage/s3";
import { getEnv } from "../../../env";
import { sendError } from "../errors";

const IdParams = z.object({ id: z.string().uuid() });

export function createArtifactsRouter(): Router {
  const router = Router();

  // GET /api/artifacts — "My Artifacts" (owner's own); see implementation-plan.md Phase 2 and
  // MyArtifactsQuery's own doc comment for why scope/facets beyond `mine` aren't supported yet.
  router.get("/", async (req, res) => {
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

    const comment = await createComment(artifact.id, viewer.id, body.data.body);
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
    const expiresAt = computeExpiresAt(body.data.expiry, now);

    await updateArtifactPolicy(artifact.id, {
      audienceType: resolved.audienceType,
      expiresAt,
      allowedUserIds: resolved.allowedUserIds,
      allowedGroupIds: resolved.allowedGroupIds,
      updatedById: viewer.id,
    });

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

    const updated = await findArtifactForDetail(artifact.id);
    res.json(ArtifactDetail.parse(toDetail(updated!, viewer.id, now)));
  });

  // POST /api/artifacts/:id/share-links — owner-only; pure locator (03 §5), audit-logged.
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
    if (!canManagePolicy(viewer, toPolicy(artifact))) {
      sendError(res, 403, "forbidden", "Only the owner can create a share link");
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
    res.redirect(302, url);
  });

  return router;
}
