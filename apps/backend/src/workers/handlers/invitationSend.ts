import { getEnv } from "../../env";
import { sendMail } from "../../adapters/email/mailer";
import { buildInvitationEmail } from "../../adapters/email/templates/invitationEmail";
import type { OutboxHandler } from "../outboxDrain";

interface InvitationSendPayload extends Record<string, unknown> {
  email: string;
  token: string;
}

function isInvitationSendPayload(payload: Record<string, unknown>): payload is InvitationSendPayload {
  return typeof payload.email === "string" && typeof payload.token === "string";
}

/** Drains "invitation.send" outbox rows (docs/architecture/02 §4) by emailing the accept link. */
export const sendInvitationEmail: OutboxHandler = async (payload) => {
  if (!isInvitationSendPayload(payload)) {
    throw new Error("invitation.send payload missing email/token");
  }
  const acceptUrl = `${getEnv().APP_ORIGIN}/accept-invite?token=${payload.token}`;
  await sendMail({ to: payload.email, ...buildInvitationEmail({ acceptUrl }) });
};
