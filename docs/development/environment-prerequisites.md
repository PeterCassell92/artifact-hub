# Environment Prerequisites

*Status: dev process. Related: [`dev-and-testing-phases-guide.md`](dev-and-testing-phases-guide.md)
(how to run + test locally), [`deploy-runbook.md`](deploy-runbook.md) (provisioning + deploy steps),
[`../architecture/07-infrastructure-and-iac.md`](../architecture/07-infrastructure-and-iac.md)
(topology), [`../architecture/02-auth-identity-and-admin.md`](../architecture/02-auth-identity-and-admin.md)
(Auth0).*

What external services must exist for each environment. The design goal is that **local dev needs
almost nothing set up by hand** — Docker provides the datastores, mail, and object storage — so the
only real external dependency is an **Auth0 dev tenant**. The heavier list is for production.

Every environment uses the **same code paths**; only the *endpoints/credentials* differ (e.g. SMTP
points at MailCatcher in dev, Resend in prod; the S3 client points at MinIO in dev, Tigris in prod).

---

## Local dev

**Provided for you by `docker compose up -d`** (no accounts, no manual setup — see the
[dev guide](dev-and-testing-phases-guide.md)):

| Concern | Provided by | Endpoint |
|---------|-------------|----------|
| Database (Postgres) | `postgres` container | `localhost:5440` |
| Backend-sent email (invites/notifications) | `mailcatcher` container | SMTP `localhost:1025`, inbox http://localhost:1080 |
| Object storage (S3) | `minio` + `createbuckets` containers | API `localhost:9000`, console http://localhost:9001 |

**You must install / set up yourself:**

| Prerequisite | Why | Notes |
|--------------|-----|-------|
| **Node + Yarn** | run the apps | pinned by **Volta** (root `package.json`); `cd` into the repo auto-switches. CI/Corepack fall back to `packageManager`. |
| **Docker** (+ compose) | runs the datastores/mail/storage above; also Testcontainers | Docker Desktop or engine. |
| **Auth0 — `ArtifactHub-Dev` tenant** ⬅ *the one real external service* | all sign-in is passwordless magic link; the backend **won't boot** without `AUTH0_*` set, and both `/api` and `/mcp` validate real tokens | Auth0 is **one tenant per environment** ([`02` §1](../architecture/02-auth-identity-and-admin.md)); dev uses **`ArtifactHub-Dev`**. It needs a **passwordless (email) connection**, a **SPA application** (frontend), two **APIs/audiences** (`/api/*` + `/mcp`), and an **M2M application** for the Management API. **Full step-by-step in [Auth0 tenant setup](#auth0-tenant-setup-per-environment) below.** Magic-link emails are read from the **Auth0 tenant log**, not MailCatcher (see [`email-catcher.md`](email-catcher.md)). |

**Env files to create** (copy the committed `.env.example`s; all are git-ignored):
`./.env` (set `POSTGRES_PASSWORD`), `apps/backend/.env`, `apps/frontend/.env`.

> **Not required in dev:** Resend, Tigris, Fly, Netlify — all substituted by the Docker services or
> not exercised locally.

---

## Auth0 tenant setup (per environment)

The exact objects to create **inside each tenant** (`ArtifactHub-Dev`, then `ArtifactHub-Prod`).
The *structure* is identical across environments; only the **URLs and audience values** differ (dev
= localhost, prod = real hostnames). Do this once per tenant. Full rationale in
[`02` §1/§1.1](../architecture/02-auth-identity-and-admin.md).

### 1. Applications (OAuth clients)

- **SPA application** — **Application Type MUST be _Single Page Application_** (public client,
  Authorization Code **+ PKCE**, *no* client secret). **Not** "Regular Web Application" / a
  server-side (Next.js) quickstart — that type expects a client secret and a server callback and
  will not work with our browser-only Vite SPA.
  - **Allowed Callback URLs**, **Allowed Logout URLs**, **Allowed Web Origins** = the **SPA origin**
    (dev: `http://localhost:5173` — the **Vite** port, *not* the backend's `:3081`). `@auth0/auth0-react`
    redirects to the app origin, so no `/callback` server route is needed.
  - **API Access tab → authorize it for the App API.** Registering the API (§2) does **not** by
    itself let this application request tokens for it — on the SPA application's **API Access**
    tab, find the App API row and **Edit → enable User-delegated Access** (this is the
    Authorization-Code/PKCE grant; the M2M "Client Access" column is unrelated and stays off).
    Skipping this produces `Client "<id>" is not authorized to access resource server "<audience>"`
    at `loginWithRedirect()`.
  - Client ID → `VITE_AUTH0_CLIENT_ID` (frontend). No secret is used by the SPA.
- **M2M application** — a **separate** "Machine to Machine" app (not the SPA) for invitation
  provisioning ([`02` §4/§6](../architecture/02-auth-identity-and-admin.md)).
  - **Authorize it for the _Auth0 Management API_** and grant scopes **`create:users`, `read:users`,
    `update:users`** (Applications → *M2M app* → **APIs** tab). Client ID/secret alone are not enough
    without this grant.
  - Client ID + Secret → `AUTH0_MGMT_CLIENT_ID` / `AUTH0_MGMT_CLIENT_SECRET` (backend; **dev `.env`,
    prod `fly secrets`**). Optional in [`env.ts`](../../apps/backend/src/env.ts) so the backend boots
    without them for login-only runs.
- **MCP clients (Claude, Role B)** register **themselves** at runtime via **DCR** — do **not** create
  an app for them. Requires two tenant-level toggles (Dynamic Client Registration + Resource
  Parameter Compatibility Profile): [`Auth0configuration.md`](Auth0configuration.md).

### 2. APIs (audiences / resource servers)

Register **two** APIs. An API **Identifier is an opaque string** (URI-shaped, never actually fetched
by Auth0) that lands in the token's `aud`. Each value must be **byte-identical in all three places**
it appears, or tokens are rejected on audience mismatch:

| API (resource) | Dev Identifier | Must match in |
|---|---|---|
| App API (`/api/*`) | `http://localhost:3081/api` | Auth0 Identifier · backend `AUTH0_API_AUDIENCE` · frontend `VITE_AUTH0_AUDIENCE` |
| MCP resource (`/mcp`) | `http://localhost:3081/mcp` | Auth0 Identifier · backend `AUTH0_MCP_AUDIENCE` (**backend only** — the SPA never requests it) |

- The MCP Identifier **must be an absolute URI** (required by RFC 8707 + the MCP spec, [`02` §1](../architecture/02-auth-identity-and-admin.md)).
- Localhost identifiers are fine for dev; prod uses the real hostnames (or a stable logical URI) —
  just keep the three-way match and don't mix schemes.

### 3. Passwordless connection

Getting this to actually produce an email-only login screen takes **all four** of the following —
each one's omission fails a different way, discovered live setting up `ArtifactHub-Dev`:

- **Authentication → Passwordless → Email**: enable, then **attach it to the SPA application**
  (the connection's **Applications** tab, or the app's **Connections** tab).
- **Disable Sign Ups** on the connection — enforces the admin-invite-only user set (**R1**,
  [`02` §1.1](../architecture/02-auth-identity-and-admin.md)).
- **Detach the connections Auth0 auto-enables on every new application.** A fresh application gets
  `Username-Password-Authentication` (database) and often `google-oauth2` (social) turned on by
  default — attaching the passwordless `email` connection alone doesn't remove them. On the SPA
  application's **Connections** tab, toggle those **off**, leaving only `email` on. Symptom if
  skipped: Universal Login shows a password field + social button + "Sign up" instead of an
  email-only form.
- **Authentication → Authentication Profile → Identifier First.** Auth0's default "Identifier +
  Password" profile doesn't recognize a passwordless-only connection as valid on its combined
  login form, even with the above two steps done — symptom: `error=invalid_request&error_description=
  no connections enabled for the client`. Switching the tenant to **Identifier First** fixes
  routing at the dashboard level. The frontend additionally passes
  `authorizationParams: { connection: "email" }` on every `loginWithRedirect()` call (see
  `apps/frontend/src/auth/passwordlessConnection.ts`) so the connection is explicit in code too,
  rather than relying solely on this tenant-wide setting.
- Dev magic-link emails arrive at the **real inbox** (e.g. an `INITIAL_ADMIN_EMAILS` address) /
  the **Auth0 log** — **MailCatcher does not catch them** (it's Auth0-sent, not backend-sent).
- **For MCP OAuth (DCR):** the passwordless email connection must be **promoted to domain-level**
  (DCR clients are third-party apps limited to domain-level connections) — not needed for SPA login.
  Full DCR + Resource Parameter Compatibility Profile setup: [`Auth0configuration.md`](Auth0configuration.md).

### 4. Env value mapping (quick reference)

| Auth0 object | Backend `apps/backend/.env` | Frontend `apps/frontend/.env` |
|---|---|---|
| Tenant domain (**bare host, no `https://`** — the Management API SDK expects it) | `AUTH0_DOMAIN` | `VITE_AUTH0_DOMAIN` |
| SPA app Client ID | — | `VITE_AUTH0_CLIENT_ID` |
| App API Identifier | `AUTH0_API_AUDIENCE` | `VITE_AUTH0_AUDIENCE` |
| MCP API Identifier | `AUTH0_MCP_AUDIENCE` | — |
| M2M app Client ID / Secret | `AUTH0_MGMT_CLIENT_ID` / `AUTH0_MGMT_CLIENT_SECRET` | — |

> Prod (`ArtifactHub-Prod`): same objects in a **separate tenant**; callback/logout/origin URLs use
> the **Netlify/custom domain**, and the M2M secret + client secret live in **`fly secrets`**, never
> committed. See [`Production`](#production) below and the [deploy runbook](deploy-runbook.md).

---

## CI (GitHub Actions)

CI runs `yarn lint`, `yarn typecheck`, `yarn test` (see [`08`](../architecture/08-deployment-pipeline.md)).

| Prerequisite | Why |
|--------------|-----|
| **Node + Yarn** (via Corepack/`packageManager`) | install + run the scripts |
| **Docker** on the runner | API integration tests spin up **Testcontainers Postgres** |
| Test-scoped **Auth0** config **or** minted test tokens | the MCP HTTP black-box tests exercise a real token against `/mcp`; supply via CI env/secrets, not a browser flow |

No Fly/Netlify/Resend/Tigris accounts are needed for the test job — deploy is a separate stage with
its own credentials (below).

---

## Production

Provisioned once via the [`deploy-runbook.md`](deploy-runbook.md); the committed `fly.toml` +
`netlify.toml` are the only "IaC". Accounts/services required:

| Service | Role | Set up via |
|---------|------|-----------|
| **Fly.io** | hosts the backend + `/mcp` container | `fly launch --copy-config` (uses committed `fly.toml`) |
| **Fly Managed Postgres** | production database | `fly mpg create` + `fly mpg attach` (sets `DATABASE_URL` secret) |
| **Tigris** (S3-compatible) | production object storage | `fly storage create` (injects `AWS_*` + `BUCKET_NAME`) |
| **Resend** | invitation/notification email over SMTP | Resend account + verified sender domain; creds as `fly secrets` (`SMTP_*`) |
| **Auth0 — `ArtifactHub-Prod` tenant** | IdP: SPA login + `/mcp` OAuth Resource Server | separate prod tenant; its own app/audiences + Netlify/custom-domain callback+logout URLs; client secret + any Management API creds as `fly secrets` |
| **Netlify** | serves the built SPA (`apps/frontend/dist`) | `netlify.toml` build config; `VITE_*` set as Netlify build env vars |
| **DNS / domains** | app + API/MCP hostnames, TLS | provider of choice; point at Netlify + Fly |
| CLIs: **`flyctl`**, **`netlify`** | operator tooling | installed + logged in (`fly auth login`, `netlify login`) |

Runtime secrets live in **`fly secrets`** (never committed, never GitHub Secrets). See
[`07`](../architecture/07-infrastructure-and-iac.md) and the runbook for exact commands.
