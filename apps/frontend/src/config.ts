/**
 * The single seam for `import.meta.env.VITE_*` reads. Under Vite, `import.meta.env` is a real,
 * build-time-populated object; under Jest (no Vite transform), it's `undefined` — falling back to
 * `{}` here means modules that read from this file don't crash at import time in tests that never
 * exercise a real network call (they mock the API layer instead, per the frontend-component-testing
 * skill), instead of every test transitively crashing on `undefined.VITE_X`.
 */
const env = (import.meta as { env?: ImportMetaEnv }).env ?? ({} as Partial<ImportMetaEnv>);

export const API_BASE_URL = env.VITE_API_BASE_URL ?? "";
export const AUTH0_DOMAIN = env.VITE_AUTH0_DOMAIN ?? "";
export const AUTH0_CLIENT_ID = env.VITE_AUTH0_CLIENT_ID ?? "";
export const AUTH0_AUDIENCE = env.VITE_AUTH0_AUDIENCE ?? "";
