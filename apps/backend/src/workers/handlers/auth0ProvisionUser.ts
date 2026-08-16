import { prisma } from "../../db";
import { getEnv } from "../../env";
import { createOrGetAuth0User } from "../../adapters/auth0/managementClient";
import type { OutboxHandler } from "../outboxDrain";

interface Auth0ProvisionPayload extends Record<string, unknown> {
  userId: string;
  email: string;
}

function isAuth0ProvisionPayload(payload: Record<string, unknown>): payload is Auth0ProvisionPayload {
  return typeof payload.userId === "string" && typeof payload.email === "string";
}

/**
 * Drains "auth0.provision_user" outbox rows (docs/architecture/02 §4/§6): creates (or looks up,
 * if one already exists) the Auth0 user on the passwordless connection, then links its `user_id`
 * as our local `idpSub` — completing what acceptInvitation started synchronously.
 */
export const provisionAuth0User: OutboxHandler = async (payload) => {
  if (!isAuth0ProvisionPayload(payload)) {
    throw new Error("auth0.provision_user payload missing userId/email");
  }

  const { userId: auth0UserId } = await createOrGetAuth0User(payload.email, getEnv());
  await prisma.user.update({ where: { id: payload.userId }, data: { idpSub: auth0UserId } });
};
