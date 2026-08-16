import { jest } from "@jest/globals";
import type { Env } from "../../env";
import { createOrGetAuth0User, resetManagementTokenCache } from "./managementClient";

const DOMAIN = "test.auth0.local";

const fakeEnv = (over: Partial<Env> = {}): Env => ({
  NODE_ENV: "test",
  PORT: 3081,
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  INITIAL_ADMIN_EMAILS: "",
  APP_ORIGIN: "https://artifact-hub.test",
  AUTH0_DOMAIN: DOMAIN,
  AUTH0_API_AUDIENCE: "https://api.artifact-hub.test",
  AUTH0_MCP_AUDIENCE: "https://mcp.artifact-hub.test",
  AUTH0_MGMT_CLIENT_ID: "mgmt-client-id",
  AUTH0_MGMT_CLIENT_SECRET: "mgmt-client-secret",
  EMAIL_TRANSPORT: "smtp",
  SMTP_HOST: "localhost",
  SMTP_PORT: 1025,
  SMTP_SECURE: false,
  EMAIL_FROM: "Artifact Hub <no-reply@artifact-hub.local>",
  OUTBOX_POLL_INTERVAL_MS: 3000,
  BUCKET_NAME: "artifact-hub-test",
  AWS_ENDPOINT_URL_S3: "http://localhost:9000",
  AWS_REGION: "auto",
  ...over,
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

beforeEach(() => {
  resetManagementTokenCache();
});

describe("createOrGetAuth0User", () => {
  it("fetches a token, creates the user, and reuses the cached token on a second call", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "mgmt-token", expires_in: 86400 }))
      .mockResolvedValueOnce(jsonResponse(201, { user_id: "email|alice" }))
      .mockResolvedValueOnce(jsonResponse(201, { user_id: "email|bob" }));

    const alice = await createOrGetAuth0User("alice@test.local", fakeEnv(), fetchImpl);
    expect(alice).toEqual({ userId: "email|alice" });

    const bob = await createOrGetAuth0User("bob@test.local", fakeEnv(), fetchImpl);
    expect(bob).toEqual({ userId: "email|bob" });

    // Only one token request across both calls — the cache was reused.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`https://${DOMAIN}/oauth/token`);
  });

  it("looks up the existing user on a 409 conflict", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "mgmt-token", expires_in: 86400 }))
      .mockResolvedValueOnce(jsonResponse(409, { message: "User already exists." }))
      .mockResolvedValueOnce(jsonResponse(200, [{ user_id: "email|existing" }]));

    const result = await createOrGetAuth0User("existing@test.local", fakeEnv(), fetchImpl);
    expect(result).toEqual({ userId: "email|existing" });

    const lookupUrl = fetchImpl.mock.calls[2]?.[0] as string;
    expect(lookupUrl).toContain("/api/v2/users-by-email");
    expect(lookupUrl).toContain(encodeURIComponent("existing@test.local"));
  });

  it("throws if the 409 lookup finds nothing", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "mgmt-token", expires_in: 86400 }))
      .mockResolvedValueOnce(jsonResponse(409, {}))
      .mockResolvedValueOnce(jsonResponse(200, []));

    await expect(createOrGetAuth0User("ghost@test.local", fakeEnv(), fetchImpl)).rejects.toThrow();
  });

  it("throws on a non-409 error from user creation", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "mgmt-token", expires_in: 86400 }))
      .mockResolvedValueOnce(jsonResponse(500, { message: "boom" }));

    await expect(createOrGetAuth0User("x@test.local", fakeEnv(), fetchImpl)).rejects.toThrow();
  });

  it("throws a clear error when Management API creds are not configured", async () => {
    const fetchImpl = jest.fn<typeof fetch>();
    const env = fakeEnv({ AUTH0_MGMT_CLIENT_ID: undefined, AUTH0_MGMT_CLIENT_SECRET: undefined });

    await expect(createOrGetAuth0User("x@test.local", env, fetchImpl)).rejects.toThrow(/AUTH0_MGMT_CLIENT/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
