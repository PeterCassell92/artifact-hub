import type { Env } from "../../env";

/**
 * Auth0 Management API client (docs/architecture/02 §4/§6, environment-prerequisites.md
 * "Auth0 tenant setup" §1/§4). Hand-rolled over `fetch` rather than the `auth0` SDK — the surface
 * needed here is exactly two documented REST calls, not worth a dependency + its own client
 * lifecycle. Used only by workers/handlers/auth0ProvisionUser.ts (never inline in a request
 * handler — see the outbox pattern, 02 §6).
 */

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | undefined;

/** Test-only: clears the module-level token cache between test cases. */
export function resetManagementTokenCache(): void {
  cachedToken = undefined;
}

function requireMgmtCreds(env: Env): { clientId: string; clientSecret: string } {
  if (!env.AUTH0_MGMT_CLIENT_ID || !env.AUTH0_MGMT_CLIENT_SECRET) {
    throw new Error(
      "AUTH0_MGMT_CLIENT_ID/AUTH0_MGMT_CLIENT_SECRET must be set to provision Auth0 users (see environment-prerequisites.md)",
    );
  }
  return { clientId: env.AUTH0_MGMT_CLIENT_ID, clientSecret: env.AUTH0_MGMT_CLIENT_SECRET };
}

async function getManagementToken(env: Env, fetchImpl: typeof fetch): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const { clientId, clientSecret } = requireMgmtCreds(env);
  const res = await fetchImpl(`https://${env.AUTH0_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      audience: `https://${env.AUTH0_DOMAIN}/api/v2/`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Auth0 Management API token request failed: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.accessToken;
}

export interface Auth0User {
  /** Auth0's `user_id` — becomes our local `users.idpSub`. */
  userId: string;
}

/**
 * Creates the Auth0 user on the passwordless email connection, or — if one already exists for
 * this email (re-invite, or a previously-provisioned account) — looks it up instead. Either way
 * this is idempotent: the caller always gets back a `userId` to link.
 */
export async function createOrGetAuth0User(
  email: string,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<Auth0User> {
  const token = await getManagementToken(env, fetchImpl);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  const createRes = await fetchImpl(`https://${env.AUTH0_DOMAIN}/api/v2/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ connection: "email", email, email_verified: true }),
  });

  if (createRes.ok) {
    const created = (await createRes.json()) as { user_id: string };
    return { userId: created.user_id };
  }

  if (createRes.status === 409) {
    const lookupRes = await fetchImpl(
      `https://${env.AUTH0_DOMAIN}/api/v2/users-by-email?email=${encodeURIComponent(email)}&fields=user_id`,
      { headers },
    );
    if (!lookupRes.ok) {
      throw new Error(`Auth0 user lookup failed: ${lookupRes.status} ${await lookupRes.text()}`);
    }
    const [existing] = (await lookupRes.json()) as { user_id: string }[];
    if (!existing) {
      throw new Error(`Auth0 reported a conflict for ${email} but no existing user was found`);
    }
    return { userId: existing.user_id };
  }

  throw new Error(`Auth0 user creation failed: ${createRes.status} ${await createRes.text()}`);
}
