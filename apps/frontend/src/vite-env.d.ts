/// <reference types="vite/client" />

// Strongly-typed public env vars (Vite exposes only VITE_-prefixed vars on import.meta.env).
// Keep in sync with apps/frontend/.env(.example). All are PUBLIC — baked into the bundle.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_AUTH0_DOMAIN: string;
  readonly VITE_AUTH0_CLIENT_ID: string;
  readonly VITE_AUTH0_AUDIENCE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
