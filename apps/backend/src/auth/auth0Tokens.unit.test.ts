import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import type { Env } from "../env";
import { verifyAuth0Token, type SigningKeyResolver } from "./auth0Tokens";

const AUDIENCE = "https://api.artifact-hub.test";
const DOMAIN = "test.auth0.local";
const KID = "test-kid";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

// A hand-rolled SigningKeyResolver — exercises our own audience/issuer/expiry enforcement with
// real RS256 crypto, without a network call to a real JWKS endpoint (that path is validated
// manually in Phase 4; see docs/development/dev-and-testing-phases-guide.md §2).
const fakeResolver: SigningKeyResolver = {
  getSigningKey: async () => ({ getPublicKey: () => publicKey }),
};

const fakeEnv = (over: Partial<Env> = {}): Env => ({
  NODE_ENV: "test",
  PORT: 3081,
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  INITIAL_ADMIN_EMAILS: "",
  AUTH0_DOMAIN: DOMAIN,
  AUTH0_API_AUDIENCE: AUDIENCE,
  AUTH0_MCP_AUDIENCE: "https://mcp.artifact-hub.test",
  EMAIL_TRANSPORT: "smtp",
  SMTP_HOST: "localhost",
  SMTP_PORT: 1025,
  SMTP_SECURE: false,
  EMAIL_FROM: "Artifact Hub <no-reply@artifact-hub.local>",
  BUCKET_NAME: "artifact-hub-test",
  AWS_ENDPOINT_URL_S3: "http://localhost:9000",
  AWS_REGION: "auto",
  ...over,
});

function signToken(overrides: Partial<{ audience: string; issuer: string; expiresIn: number }> = {}) {
  return jwt.sign({}, privateKey, {
    subject: "auth0|abc123",
    audience: overrides.audience ?? AUDIENCE,
    issuer: overrides.issuer ?? `https://${DOMAIN}/`,
    algorithm: "RS256",
    keyid: KID,
    expiresIn: overrides.expiresIn ?? 3600,
  });
}

describe("verifyAuth0Token", () => {
  it("accepts a correctly signed, in-audience token", async () => {
    const env = fakeEnv();
    const payload = await verifyAuth0Token(signToken(), AUDIENCE, env, fakeResolver);
    expect(payload.sub).toBe("auth0|abc123");
  });

  it("rejects the wrong audience", async () => {
    const env = fakeEnv();
    await expect(
      verifyAuth0Token(signToken({ audience: "https://someone-else.example" }), AUDIENCE, env, fakeResolver),
    ).rejects.toThrow();
  });

  it("rejects the wrong issuer", async () => {
    const env = fakeEnv();
    await expect(
      verifyAuth0Token(signToken({ issuer: "https://not-us.example/" }), AUDIENCE, env, fakeResolver),
    ).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const env = fakeEnv();
    await expect(
      verifyAuth0Token(signToken({ expiresIn: -10 }), AUDIENCE, env, fakeResolver),
    ).rejects.toThrow();
  });

  it("rejects a malformed token", async () => {
    const env = fakeEnv();
    await expect(verifyAuth0Token("not-a-jwt", AUDIENCE, env, fakeResolver)).rejects.toThrow();
  });
});
