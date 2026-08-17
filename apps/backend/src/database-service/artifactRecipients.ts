import { randomUUID } from "node:crypto";
import type { AudienceType } from "contracts";
import { logger } from "../logger";
import { newlyGrantedIds } from "../core/policy";
import type { EnqueueOutboxEventInput } from "./outbox";
import { findUsersByIds, findUsersInGroups, listActiveUsers } from "./adminUsers";

export interface PolicyForRecipients {
  audienceType: AudienceType;
  allowedUserIds: string[];
  allowedGroupIds: string[];
}

export interface Recipient {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Active users who currently have access under `policy` — the reverse of `core/authz#canView`:
 * given a policy, who's in the audience? `public_authenticated` resolves to every active user,
 * matching how `canView` treats that audience type (any authenticated user is allowed).
 */
export async function resolvePolicyRecipients(policy: PolicyForRecipients): Promise<Recipient[]> {
  const users =
    policy.audienceType === "public_authenticated"
      ? await listActiveUsers()
      : policy.audienceType === "specific_users"
        ? await findUsersByIds(policy.allowedUserIds)
        : await findUsersInGroups(policy.allowedGroupIds);

  return users.map((u) => ({ id: u.id, email: u.email, name: u.name }));
}

function excludeOwner(recipients: Recipient[], ownerId: string): Recipient[] {
  return recipients.filter((r) => r.id !== ownerId);
}

function toOutboxEvent(
  type: string,
  artifactId: string,
  recipient: Recipient,
  idempotencyKey: string,
): EnqueueOutboxEventInput {
  return {
    type,
    payload: {
      artifactId,
      recipientUserId: recipient.id,
      recipientEmail: recipient.email,
      recipientName: recipient.name,
    },
    idempotencyKey,
  };
}

/** Publish-time (B) — no "before" policy exists yet, so every resolved recipient is notified. */
export async function buildPublishNotificationEvents(
  artifactId: string,
  ownerId: string,
  policy: PolicyForRecipients,
): Promise<EnqueueOutboxEventInput[]> {
  const recipients = excludeOwner(await resolvePolicyRecipients(policy), ownerId);
  logger.info(
    { artifactId, outboxType: "artifact.new_access", recipientCount: recipients.length },
    "resolved notification recipients",
  );
  return recipients.map((r) =>
    toOutboxEvent("artifact.new_access", artifactId, r, `artifact-new-access:${artifactId}:${r.id}:publish`),
  );
}

/**
 * Save-Policy-time (B) — only users newly granted access (present in `afterPolicy`'s resolved
 * recipients, absent from `beforePolicy`'s) are notified; people who already had access aren't
 * re-notified on every edit.
 */
export async function buildNewAccessOutboxEvents(
  artifact: { id: string; ownerId: string },
  beforePolicy: PolicyForRecipients,
  afterPolicy: PolicyForRecipients,
): Promise<EnqueueOutboxEventInput[]> {
  const [beforeRecipients, afterRecipients] = await Promise.all([
    resolvePolicyRecipients(beforePolicy),
    resolvePolicyRecipients(afterPolicy),
  ]);

  const grantedIds = new Set(
    newlyGrantedIds(
      beforeRecipients.map((r) => r.id),
      afterRecipients.map((r) => r.id),
    ),
  );
  const newlyGranted = excludeOwner(
    afterRecipients.filter((r) => grantedIds.has(r.id)),
    artifact.ownerId,
  );

  logger.info(
    { artifactId: artifact.id, outboxType: "artifact.new_access", recipientCount: newlyGranted.length },
    "resolved notification recipients",
  );

  return newlyGranted.map((r) =>
    toOutboxEvent(
      "artifact.new_access",
      artifact.id,
      r,
      `artifact-new-access:${artifact.id}:${r.id}:${randomUUID()}`,
    ),
  );
}

/**
 * Explicit "Revoke all access" (C) — one event per recipient under the still-intact policy at the
 * moment of revoke (`revokeArtifactAccess` only flips `revoked`, leaving the allow-lists as-is).
 */
export async function buildAccessRevokedOutboxEvents(
  artifact: { id: string; ownerId: string },
  currentPolicy: PolicyForRecipients,
): Promise<EnqueueOutboxEventInput[]> {
  const recipients = excludeOwner(await resolvePolicyRecipients(currentPolicy), artifact.ownerId);
  logger.info(
    { artifactId: artifact.id, outboxType: "artifact.access_revoked", recipientCount: recipients.length },
    "resolved notification recipients",
  );
  return recipients.map((r) =>
    toOutboxEvent(
      "artifact.access_revoked",
      artifact.id,
      r,
      `artifact-access-revoked:${artifact.id}:${r.id}:${randomUUID()}`,
    ),
  );
}
