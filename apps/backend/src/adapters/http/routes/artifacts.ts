import { Router } from "express";
import { z } from "zod";
import {
  AccessEventListResponse,
  AccessEventListQuery,
  AccessPolicyInput,
  ArtifactDetail,
  ArtifactEnrichmentListResponse,
  ArtifactFacetOptions,
  ArtifactListQuery,
  ArtifactListResponse,
  ArtifactRelationshipCreateResponse,
  ArtifactRelationshipInput,
  ArtifactRelationshipSummary,
  CommentView,
  CreateArtifactInput,
  CreateArtifactResponse,
  CreateCommentInput,
  DownloadUrlResponse,
  FinalizeArtifactInput,
  MAX_ARTIFACT_SIZE_BYTES,
  ReissueUploadUrlResponse,
  ShareLinkView,
  TriggerEnrichmentResponse,
} from "contracts";
import { canCreateShareLink, canManagePolicy, canView } from "../../../core/authz";
import { computeExpiresAt } from "../../../core/policy";
import { listAccessEvents } from "../../../database-service/accessEvents";
import {
  checkViewAndAudit,
  createArtifactPending,
  finalizeArtifact,
  findArtifactForDetail,
  getArtifactFacets,
  listOwnedArtifacts,
  listSharedWithMe,
  reissueUploadUrl,
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
import { createRelationship, createRelationships, deleteRelationship, listRelationships } from "../../../database-service/relationships";
import { createShareLink } from "../../../database-service/shareLinks";
import { enqueueEnrichment, listEnrichments } from "../../../database-service/enrichment";
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

  // POST /api/artifacts — creates a pending artifact + returns a presigned PUT for the bytes.
  // No canView/canManagePolicy check — there's no existing artifact yet; the authenticated caller
  // simply becomes the owner. Backs both the SPA's "Publish New Artifact" modal and (in principle)
  // any other REST-facing caller; the MCP publish_artifact tool still calls createArtifactPending
  // directly rather than through this route.
  router.post("/", async (req, res) => {
    const body = CreateArtifactInput.safeParse(req.body);
    if (!body.success) {
      sendError(res, 400, "bad_request", "Invalid artifact input", body.error.flatten());
      return;
    }

    const resolved = await resolveAudienceInput(body.data);
    if (!resolved.ok) {
      sendError(res, 400, "bad_request", resolved.error, resolved.details);
      return;
    }

    const viewer = req.viewer!;
    const { artifact, uploadUrl } = await createArtifactPending(viewer.id, {
      title: body.data.title,
      description: body.data.description,
      fileName: body.data.fileName,
      contentType: body.data.contentType,
      kind: body.data.kind,
      tags: body.data.tags,
      sourceTool: body.data.sourceTool,
      language: body.data.language,
      metadata: body.data.metadata,
      audienceType: resolved.audienceType,
      allowedUserIds: resolved.allowedUserIds,
      allowedGroupIds: resolved.allowedGroupIds,
      // "now" — this artifact's own createdAt, unlike PUT /policy's edit-time computation which is
      // relative to an *existing* createdAt. Matches how the MCP tool calls
      // computeExpiresAt(args.expiry!, new Date()) at creation time.
      expiresAt: computeExpiresAt(body.data.expiry, new Date()),
    });

    // Optional enrichment, not a publish precondition — mirrors the MCP publish_artifact tool's
    // relationships handling (docs/architecture/05 §4): a bad toId is reported per-entry below,
    // never fails the artifact that was just successfully created.
    const relationshipResults = body.data.relationships?.length
      ? (await createRelationships(artifact.id, viewer, body.data.relationships)).map((r) =>
          r.ok ? { ...r, createdAt: r.createdAt.toISOString() } : r,
        )
      : [];

    res.status(201).json(
      CreateArtifactResponse.parse({
        artifactId: artifact.id,
        uploadUrl,
        ...(relationshipResults.length ? { relationshipResults } : {}),
      }),
    );
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

    res.json(ArtifactDetail.parse(toDetail(artifact, viewer, now)));
  });

  // GET /api/artifacts/:id/access-events — the audit-trail read side (docs/models/access-event.md
  // §6): who viewed/downloaded this artifact and when, including denied attempts. Owner or admin
  // only — a stricter gate than canView, since this is "who else can see it" rather than "can I
  // see it". No AccessEvent is written for reading this list itself.
  router.get("/:id/access-events", async (req, res) => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      sendError(res, 400, "bad_request", "Invalid artifact id");
      return;
    }

    const query = AccessEventListQuery.safeParse(req.query);
    if (!query.success) {
      sendError(res, 400, "bad_request", "Invalid query", query.error.flatten());
      return;
    }

    const artifact = await findArtifactForDetail(params.data.id);
    if (!artifact) {
      sendError(res, 404, "not_found", "Artifact not found");
      return;
    }

    const viewer = req.viewer!;
    if (!canManagePolicy(viewer, toPolicy(artifact)) && viewer.role !== "admin") {
      sendError(res, 403, "forbidden", "Only the owner or an admin can view this artifact's access history");
      return;
    }

    const { items, nextCursor } = await listAccessEvents(artifact.id, query.data);
    res.json(AccessEventListResponse.parse({ items, nextCursor }));
  });

  // GET /api/artifacts/:id/enrichment — the AI-enrichment job history (docs/architecture/01
  // decision #46), newest first. Owner-only, same gate as /access-events — this is "how did the
  // background job that ran on my artifact behave", not "can I view this artifact".
  router.get("/:id/enrichment", async (req, res) => {
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
      sendError(res, 403, "forbidden", "Only the owner can view this artifact's enrichment history");
      return;
    }

    const items = await listEnrichments(artifact.id);
    res.json(ArtifactEnrichmentListResponse.parse({ items }));
  });

  // POST /api/artifacts/:id/enrich — owner-only rerun trigger. Always starts a fresh run (its own
  // idempotencyKey, distinct from the publish-triggered one) rather than reusing/cancelling any
  // prior run — history is append-only (see ArtifactEnrichment's doc comment).
  router.post("/:id/enrich", async (req, res) => {
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
      sendError(res, 403, "forbidden", "Only the owner can re-run enrichment for this artifact");
      return;
    }

    const { enrichmentId } = await enqueueEnrichment({ artifactId: artifact.id, requestedById: viewer.id, trigger: "rerun" });
    res.json(TriggerEnrichmentResponse.parse({ enrichmentId, status: "pending" }));
  });

  // POST /api/artifacts/:id/finalize — confirms the presigned-PUT upload actually landed
  // (headObject) before recording size/checksum. Ownership is checked inside finalizeArtifact
  // itself (reason: "forbidden") — this isn't a policy check, just "do you own this row".
  router.post("/:id/finalize", async (req, res) => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      sendError(res, 400, "bad_request", "Invalid artifact id");
      return;
    }
    const body = FinalizeArtifactInput.safeParse(req.body ?? {});
    if (!body.success) {
      sendError(res, 400, "bad_request", "Invalid finalize input", body.error.flatten());
      return;
    }

    const viewer = req.viewer!;
    const result = await finalizeArtifact(params.data.id, viewer.id, { checksumSha256: body.data.checksumSha256 });

    if (!result.ok) {
      if (result.reason === "not_found") {
        sendError(res, 404, "not_found", "Artifact not found");
        return;
      }
      if (result.reason === "forbidden") {
        sendError(res, 403, "forbidden", "You do not own this artifact");
        return;
      }
      if (result.reason === "too_large") {
        sendError(
          res,
          413,
          "payload_too_large",
          `File exceeds the ${MAX_ARTIFACT_SIZE_BYTES / (1024 * 1024)}MB limit`,
        );
        return;
      }
      // "object_missing" — the PUT hasn't landed yet; retryable, not a hard client error.
      sendError(res, 409, "conflict", "The file hasn't finished uploading yet — retry once the PUT completes");
      return;
    }

    res.json(ArtifactDetail.parse(toDetail(result.artifact, viewer, new Date())));
  });

  // POST /api/artifacts/:id/upload-url — re-mints a fresh presigned PUT for a still-pending
  // artifact (decision #47). Backs the browser completion page reached via the MCP
  // publish_artifact tool's webUploadUrl (or a resumed abandoned SPA upload): the id-only page
  // URL carries no secret, so this route's ownership check is the actual gate — the link
  // locates, session auth + ownership decide (03 §5's share-link principle applied to writes).
  router.post("/:id/upload-url", async (req, res) => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      sendError(res, 400, "bad_request", "Invalid artifact id");
      return;
    }

    const viewer = req.viewer!;
    const result = await reissueUploadUrl(params.data.id, viewer.id);

    if (!result.ok) {
      if (result.reason === "not_found") {
        sendError(res, 404, "not_found", "Artifact not found");
        return;
      }
      if (result.reason === "forbidden") {
        sendError(res, 403, "forbidden", "You do not own this artifact");
        return;
      }
      // "already_finalized" — nothing left to resume; the artifact is fully published.
      sendError(res, 409, "conflict", "This artifact has already finished uploading");
      return;
    }

    req.log.info({ userId: viewer.id, artifactId: params.data.id }, "artifact.upload_url.reissue");
    res.json(ReissueUploadUrlResponse.parse({ uploadUrl: result.uploadUrl }));
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

    // Drafts (sizeBytes === 0, decision #47) don't email on policy edits — nobody can see the
    // artifact yet, and finalizeArtifact notifies the full audience as it stands at finalize.
    const newAccessOutboxEvents =
      artifact.sizeBytes > BigInt(0)
        ? await buildNewAccessOutboxEvents(
            { id: artifact.id, ownerId: artifact.ownerId },
            before,
            { audienceType: resolved.audienceType, allowedUserIds: resolved.allowedUserIds, allowedGroupIds: resolved.allowedGroupIds },
          )
        : [];

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
    res.json(ArtifactDetail.parse(toDetail(updated!, viewer, now)));
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

    // Drafts don't email on revoke (decision #47) — no publish notification ever went out, so
    // there's no granted access to walk back in anyone's inbox.
    const outboxEvents =
      artifact.sizeBytes > BigInt(0)
        ? await buildAccessRevokedOutboxEvents(
            { id: artifact.id, ownerId: artifact.ownerId },
            toPolicy(artifact),
          )
        : [];
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
    res.json(ArtifactDetail.parse(toDetail(updated!, viewer, new Date())));
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

  // GET /api/artifacts/:id/relationships — every relationship touching this artifact, either
  // direction. canView-gated like comments; each row's other side is independently redacted by
  // listRelationships when the caller can't see it, so this never leaks a private artifact.
  router.get("/:id/relationships", async (req, res) => {
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

    const relationships = await listRelationships(viewer, artifact.id);
    res.json(z.array(ArtifactRelationshipSummary).parse(relationships));
  });

  // POST /api/artifacts/:id/relationships — owner-only (canManagePolicy), same as policy
  // mutations. The target side's existence/visibility is validated inside createRelationship,
  // not here — see 03: canView is the one authorization gate, never re-implemented per route.
  router.post("/:id/relationships", async (req, res) => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      sendError(res, 400, "bad_request", "Invalid artifact id");
      return;
    }

    const body = ArtifactRelationshipInput.safeParse(req.body);
    if (!body.success) {
      sendError(res, 400, "bad_request", "Invalid relationship input", body.error.flatten());
      return;
    }

    const artifact = await findArtifactForDetail(params.data.id);
    if (!artifact) {
      sendError(res, 404, "not_found", "Artifact not found");
      return;
    }

    const viewer = req.viewer!;
    if (!canManagePolicy(viewer, toPolicy(artifact))) {
      sendError(res, 403, "forbidden", "Only the owner can link this artifact to another");
      return;
    }

    const result = await createRelationship(artifact.id, viewer, body.data);
    if (!result.ok) {
      switch (result.reason) {
        case "self_link":
          sendError(res, 400, "bad_request", "An artifact cannot be related to itself");
          return;
        case "to_not_found":
          sendError(res, 404, "not_found", "Target artifact not found");
          return;
        case "to_not_viewable":
          sendError(res, 403, "forbidden", "You do not have access to the target artifact");
          return;
        case "duplicate":
          sendError(res, 409, "conflict", "This relationship already exists");
          return;
      }
    }

    res.status(201).json(
      ArtifactRelationshipCreateResponse.parse({
        relationshipId: result.relationshipId,
        createdAt: result.createdAt.toISOString(),
      }),
    );
  });

  // DELETE /api/artifacts/:id/relationships/:relationshipId — retract a relationship. Ownership
  // is resolved from the relationship's own `fromId` inside deleteRelationship (not from this
  // route's `:id`, which is only here for the nested URL shape matching GET/POST above) — the
  // `to` side's owner has no say, matching who could create it in the first place.
  router.delete("/:id/relationships/:relationshipId", async (req, res) => {
    const params = z
      .object({ id: z.string().uuid(), relationshipId: z.string().uuid() })
      .safeParse(req.params);
    if (!params.success) {
      sendError(res, 400, "bad_request", "Invalid id");
      return;
    }

    const result = await deleteRelationship(params.data.relationshipId, req.viewer!);
    if (!result.ok) {
      if (result.reason === "not_found") {
        sendError(res, 404, "not_found", "Relationship not found");
        return;
      }
      sendError(res, 403, "forbidden", "Only the owner of the relationship's source artifact can remove it");
      return;
    }

    res.status(204).send();
  });

  return router;
}
