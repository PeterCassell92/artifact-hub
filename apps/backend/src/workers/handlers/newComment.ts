import { getEnv } from "../../env";
import { sendMail } from "../../adapters/email/mailer";
import { buildNewCommentEmail } from "../../adapters/email/templates/newCommentEmail";
import { findArtifactForDetail } from "../../database-service/artifacts";
import { logger } from "../../logger";
import type { OutboxHandler } from "../outboxDrain";

interface NewCommentPayload extends Record<string, unknown> {
  artifactId: string;
  recipientEmail: string;
  recipientName: string | null;
  commenterName: string;
}

function isNewCommentPayload(payload: Record<string, unknown>): payload is NewCommentPayload {
  return (
    typeof payload.artifactId === "string" &&
    typeof payload.recipientEmail === "string" &&
    typeof payload.commenterName === "string"
  );
}

/** Drains "artifact.new_comment" outbox rows — emails the owner and prior distinct commenters
 * about a new comment. */
export const sendNewCommentEmail: OutboxHandler = async (payload) => {
  if (!isNewCommentPayload(payload)) {
    throw new Error("artifact.new_comment payload missing required fields");
  }

  const artifact = await findArtifactForDetail(payload.artifactId);
  if (!artifact) throw new Error(`artifact ${payload.artifactId} not found`);

  const email = buildNewCommentEmail({
    recipientName: (payload.recipientName as string | null) ?? null,
    commenterName: payload.commenterName,
    artifactTitle: artifact.title,
    artifactId: artifact.id,
    appOrigin: getEnv().APP_ORIGIN,
  });

  await sendMail({ to: payload.recipientEmail, ...email });
  logger.info({ artifactId: artifact.id, recipientEmail: payload.recipientEmail }, "sent new-comment email");
};
