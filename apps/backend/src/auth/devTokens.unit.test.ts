import jwt from "jsonwebtoken";
import type { Env } from "../env";
import { DEV_JWT_ISSUER, mintDevToken, verifyDevToken } from "./devTokens";

const API_AUDIENCE = "https://api.artifact-hub.test";
const MCP_AUDIENCE = "https://mcp.artifact-hub.test";

const fakeEnv = (over: Partial<Env> = {}): Env => ({
  NODE_ENV: "test",
  PORT: 3081,
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  INITIAL_ADMIN_EMAILS: "",
  AUTH0_DOMAIN: "test.auth0.local",
  AUTH0_API_AUDIENCE: API_AUDIENCE,
  AUTH0_MCP_AUDIENCE: MCP_AUDIENCE,
  EMAIL_TRANSPORT: "smtp",
  SMTP_HOST: "localhost",
  SMTP_PORT: 1025,
  SMTP_SECURE: false,
  EMAIL_FROM: "Artifact Hub <no-reply@artifact-hub.local>",
  BUCKET_NAME: "artifact-hub-test",
  AWS_ENDPOINT_URL_S3: "http://localhost:9000",
  AWS_REGION: "auto",
  DEV_JWT_SIGNING_SECRET: "unit-test-dev-signing-secret",
  DEV_MINT_SECRET: "unit-test-dev-mint-secret",
  ...over,
});

describe("mintDevToken / verifyDevToken", () => {
  it("round-trips a token minted for the right audience", () => {
    const env = fakeEnv();
    const token = mintDevToken({ sub: "user-1", audience: MCP_AUDIENCE }, env);
    const payload = verifyDevToken(token, MCP_AUDIENCE, env);
    expect(payload.sub).toBe("user-1");
    expect(payload.aud).toBe(MCP_AUDIENCE);
    expect(payload.iss).toBe(DEV_JWT_ISSUER);
  });

  it("rejects a token presented at the wrong audience", () => {
    const env = fakeEnv();
    const token = mintDevToken({ sub: "user-1", audience: API_AUDIENCE }, env);
    expect(() => verifyDevToken(token, MCP_AUDIENCE, env)).toThrow();
  });

  it("rejects an expired token", () => {
    const env = fakeEnv();
    const token = mintDevToken({ sub: "user-1", audience: MCP_AUDIENCE, expiresInSeconds: -10 }, env);
    expect(() => verifyDevToken(token, MCP_AUDIENCE, env)).toThrow();
  });

  it("rejects a token with the wrong issuer", () => {
    const env = fakeEnv();
    const foreignToken = jwt.sign({}, env.DEV_JWT_SIGNING_SECRET as string, {
      subject: "user-1",
      audience: MCP_AUDIENCE,
      issuer: "https://not-us.example/",
      algorithm: "HS256",
      expiresIn: 3600,
    });
    expect(() => verifyDevToken(foreignToken, MCP_AUDIENCE, env)).toThrow();
  });

  it("rejects a token signed with a different secret", () => {
    const env = fakeEnv();
    const tampered = jwt.sign({}, "some-other-secret", {
      subject: "user-1",
      audience: MCP_AUDIENCE,
      issuer: DEV_JWT_ISSUER,
      algorithm: "HS256",
      expiresIn: 3600,
    });
    expect(() => verifyDevToken(tampered, MCP_AUDIENCE, env)).toThrow();
  });

  it("refuses to mint in production", () => {
    const env = fakeEnv({ NODE_ENV: "production" });
    expect(() => mintDevToken({ sub: "user-1", audience: MCP_AUDIENCE }, env)).toThrow();
  });
});
