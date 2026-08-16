import jwt, { type JwtPayload } from "jsonwebtoken";
import jwksRsa from "jwks-rsa";
import type { Env } from "../env";

/** Just the bit of jwks-rsa's JwksClient our verifier needs — lets tests inject a fake. */
export interface SigningKeyResolver {
  getSigningKey(kid: string | null | undefined): Promise<{ getPublicKey(): string }>;
}

const jwksClients = new Map<string, SigningKeyResolver>();

function defaultResolver(domain: string): SigningKeyResolver {
  let client = jwksClients.get(domain);
  if (!client) {
    client = jwksRsa({
      jwksUri: `https://${domain}/.well-known/jwks.json`,
      cache: true,
      rateLimit: true,
    });
    jwksClients.set(domain, client);
  }
  return client;
}

/** Verifies a real Auth0-issued RS256 access token (docs/architecture/02 §1). */
export async function verifyAuth0Token(
  token: string,
  audience: string,
  env: Env,
  resolver: SigningKeyResolver = defaultResolver(env.AUTH0_DOMAIN),
): Promise<JwtPayload> {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded.payload === "string" || !decoded.header.kid) {
    throw new Error("Malformed token");
  }

  const signingKey = await resolver.getSigningKey(decoded.header.kid);

  return jwt.verify(token, signingKey.getPublicKey(), {
    algorithms: ["RS256"],
    audience,
    issuer: `https://${env.AUTH0_DOMAIN}/`,
  }) as JwtPayload;
}
