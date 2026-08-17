import { sendMail } from "../../adapters/email/mailer";
import { buildAccessRevokedEmail } from "../../adapters/email/templates/accessRevokedEmail";
import { findArtifactForDetail } from "../../database-service/artifacts";
import { logger } from "../../logger";
import type { OutboxHandler } from "../outboxDrain";

interface AccessRevokedPayload extends Record<string, unknown> {
  artifactId: string;
  recipientEmail: string;
  recipientName: string | null;
}

function isAccessRevokedPayload(payload: Record<string, unknown>): payload is AccessRevokedPayload {
  return typeof payload.artifactId === "string" && typeof payload.recipientEmail === "string";
}

/** Drains "artifact.access_revoked" outbox rows — emails a recipient that their access to an
 * artifact was just explicitly revoked. */
export const sendAccessRevokedEmail: OutboxHandler = async (payload) => {
  if (!isAccessRevokedPayload(payload)) {
    throw new Error("artifact.access_revoked payload missing artifactId/recipientEmail");
  }

  const artifact = await findArtifactForDetail(payload.artifactId);
  if (!artifact) throw new Error(`artifact ${payload.artifactId} not found`);

  const email = buildAccessRevokedEmail({
    recipientName: (payload.recipientName as string | null) ?? null,
    artifactTitle: artifact.title,
  });

  await sendMail({ to: payload.recipientEmail, ...email });
  logger.info({ artifactId: artifact.id, recipientEmail: payload.recipientEmail }, "sent access-revoked email");
};
