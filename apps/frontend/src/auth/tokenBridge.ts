/**
 * Bridges @auth0/auth0-react's hook-based `getAccessTokenSilently` into RTK Query's imperative
 * `baseQuery` (not a hook). A no-UI `AuthTokenBridge` component sets this once Auth0 is ready.
 *
 * Swallowing a silent-auth failure into `undefined` (rather than throwing) is intentional, not a
 * fallback: it's exactly the right behavior for the unauthenticated public invitation routes
 * (`/accept-invite`), which must be callable with no `Authorization` header at all.
 */
let tokenGetter: (() => Promise<string>) | null = null;

export function setTokenGetter(fn: (() => Promise<string>) | null): void {
  tokenGetter = fn;
}

export async function getAccessToken(): Promise<string | undefined> {
  if (!tokenGetter) return undefined;
  try {
    return await tokenGetter();
  } catch {
    return undefined;
  }
}
