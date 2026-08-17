import { getEnv } from "../../env";
import { sendMail } from "../../adapters/email/mailer";
import { buildNewArtifactAccessEmail } from "../../adapters/email/templates/newArtifactAccessEmail";
import { findArtifactForDetail } from "../../database-service/artifacts";
import { logger } from "../../logger";
import type { OutboxHandler } from "../outboxDrain";

interface NewArtifactAccessPayload extends Record<string, unknown> {
  artifactId: string;
  recipientEmail: string;
  recipientName: string | null;
}

function isNewArtifactAccessPayload(payload: Record<string, unknown>): payload is NewArtifactAccessPayload {
  return typeof payload.artifactId === "string" && typeof payload.recipientEmail === "string";
}

/** Drains "artifact.new_access" outbox rows — emails a recipient that an artifact is newly
 * accessible to them (publish, or Save Policy widening the audience). */
export const sendNewArtifactAccessEmail: OutboxHandler = async (payload) => {
  if (!isNewArtifactAccessPayload(payload)) {
    throw new Error("artifact.new_access payload missing artifactId/recipientEmail");
  }

  const artifact = await findArtifactForDetail(payload.artifactId);
  if (!artifact) throw new Error(`artifact ${payload.artifactId} not found`);

  const email = buildNewArtifactAccessEmail({
    recipientName: (payload.recipientName as string | null) ?? null,
    artifact: {
      id: artifact.id,
      title: artifact.title,
      kind: artifact.kind,
      contentType: artifact.contentType,
      fileName: artifact.fileName,
      sizeBytes: Number(artifact.sizeBytes),
    },
    appOrigin: getEnv().APP_ORIGIN,
  });

  await sendMail({ to: payload.recipientEmail, ...email });
  logger.info({ artifactId: artifact.id, recipientEmail: payload.recipientEmail }, "sent new-access email");
};
