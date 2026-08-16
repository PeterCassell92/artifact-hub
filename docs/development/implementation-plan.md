# Implementation Plan (handoff)

*Status: active — implementation kickoff. Audience: a fresh Claude Code session picking up the
build. Read [`../architecture/01-overview.md`](../architecture/01-overview.md) first (decision log +
core principles), then this. Design is complete; this is the build order.*

This is the **build sequence** from the current scaffold to a running v1. Each phase is a **vertical
slice** with a goal, concrete tasks, the files it touches, its tests, and an acceptance check. Do the
phases in order — later phases depend on earlier ones. Keep slices small and green (tests passing)
before moving on.

---

## 0. Orientation — current state (verified)

**Done:** all design docs; full Prisma schema ([`../../apps/backend/prisma/schema.prisma`](../../apps/backend/prisma/schema.prisma),
14 models / 9 enums); shared contracts ([`packages/contracts`](../../packages/contracts)); the
**core authz decision** ([`authz.ts`](../../apps/backend/src/core/authz.ts)) with unit tests; the
backend shell (app/env/db/logger/index, health+ready checks); a seed script; the frontend scaffold
(Redux store, notifications slice, `NotificationRegion`+`Modal`).

**Not done (this plan builds it):** DB migrations (none exist), **auth/token-validation middleware**,
all `/api/*` routes (return 501), the entire **MCP surface** (returns 501), the invitation/outbox
flow, all frontend views + Auth0 wiring, and most tests.

**Golden rules (from [`../../CLAUDE.md`](../../CLAUDE.md) — do not violate):**
- Route/MCP handlers call `core` authz (`canView`/`canComment`/`canManagePolicy`) — never re-implement checks.
- Read `role`/groups from the **DB**, never from token claims.
- Keep request/response types in `packages/contracts`; **rebuild it** (`yarn workspace contracts build`) after edits — apps consume its `dist`.
- No anonymous access; publishing is **MCP-only**; files never return as MCP tool results (Resources only); every access writes an `AccessEvent`.
- Frontend: no `window.alert/confirm/prompt`, no toasts — state-driven in-DOM notifications + `role="dialog"` modals only.
- Migrations are **expand/contract**, never edit an applied one (skill: `prisma-migrate`).

**Environment gotchas (already sorted, don't re-litigate):**
- Backend loads `.env` via `import "dotenv/config"` (first line of [`index.ts`](../../apps/backend/src/index.ts)); it reads from **cwd**, so run via `yarn workspace backend <script>`.
- `docker compose up` does **not** run migrations — run `db:migrate` yourself.
- Auth0 audiences are byte-matched across the Auth0 API Identifier + backend env + frontend env; the **MCP audience is backend-only**. See [`environment-prerequisites.md`](environment-prerequisites.md) → *Auth0 tenant setup*.
- Frontend env is Vite-native (`import.meta.env.VITE_*`, typed in [`vite-env.d.ts`](../../apps/frontend/src/vite-env.d.ts)) — no dotenv.

---

## Phase 0 — Live database + green baseline

**Goal:** the stack runs, DB is migrated + seeded, existing tests pass.

- `docker compose up -d`; copy the three `.env.example`s if not already (root, backend, frontend).
- `yarn install`; `yarn workspace contracts build`; `yarn workspace backend prisma:generate`.
- `yarn workspace backend db:migrate` → **generates the first migration** from the existing schema; `db:seed`.
- Verify: `yarn workspace backend dev` boots and logs "listening"; `GET /healthz` and `GET /readyz` return `{ok:true}`; `yarn test` green.

**Acceptance:** migrated DB with seeded groups + initial admin(s); backend serves health checks; baseline tests pass.

---

## Phase 1 — Auth foundation (the keystone; [`02`](../architecture/02-auth-identity-and-admin.md))

**Goal:** every protected request is authenticated + resolved to an active local user. Nothing above works without this.

- **Shared token-validation middleware**, parameterised by expected audience (used by both `/api/*` and `/mcp`):
  - Verify JWT signature via **JWKS** (`jwks-rsa`), check `iss`, `exp`, and **`aud`** (reject if not the endpoint's audience — R2). Deps already installed (`jsonwebtoken`, `jwks-rsa`).
  - Resolve `sub` → local `users` row; **deny if missing or `status != active`** (R1/R4). Never auto-provision.
  - Attach a `Viewer` (`{id, status, groupIds}`, role) loaded from the DB to the request.
  - Error contract per [`06`](../architecture/06-api-design.md) (`401` unauthenticated, `403` denied).
- **Shared test-token helper** — signs API- and MCP-audience JWTs with a dev/test key the validator trusts **only in dev/test** (mirrors the `09` §3 approach). Used by Jest and by:
- **Test-only token-mint endpoint** `POST /test/mcp-token` — env-gated (not mounted in prod), `X-Test-Token` guard, active-user check. Spec + guardrails in [`bruno-mcp-token.md`](bruno-mcp-token.md).
- **`/api/admin/*` guard**: require the API audience **and** `role=admin` from the DB (R3).

**Tests:** unit (audience/expiry/issuer accept+reject; disabled-user deny; missing-user deny); integration (supertest: a protected route 401s without token, 200s with a minted valid token, 403s for wrong audience).

**Acceptance:** a request with a minted valid token resolves to the seeded user; wrong-audience/expired/disabled/unknown-user all correctly denied; the test-token endpoint is absent when `NODE_ENV=production` (assert this in a test).

---

## Phase 2 — First API vertical slice: read artifacts ([`06`](../architecture/06-api-design.md) §2)

**Goal:** prove auth + core authz + Prisma + `AccessEvent` end to end on the read path.

- Data-access for artifacts/policy/comments (Prisma queries → map to the `ArtifactPolicy`/`Viewer` shapes `authz.ts` expects).
- Implement over the existing `notImplemented` stubs in [`router.ts`](../../apps/backend/src/adapters/http/router.ts):
  - `GET /api/artifacts` (My Artifacts — owner's own), `GET /api/artifacts/:id` (gated by `canView`), `GET /api/artifacts/:id/comments`.
  - Write an **`AccessEvent`** on view/download (allowed + denied) per [`../models/access-event.md`](../models/access-event.md).
- Validate inputs/outputs against `packages/contracts` zod schemas.

**Tests:** API integration (supertest + **Testcontainers Postgres**): in-audience 200, out-of-audience 403, expired 403, owner-after-expiry 200; assert an `AccessEvent` row is written.

**Acceptance:** authenticated user can list their artifacts and fetch one they may view; denials are correct and audited.

---

## Phase 3 — Remaining `/api/*` (write / manage / admin)

**Goal:** complete the REST surface ([`06`](../architecture/06-api-design.md)).

- `POST /api/artifacts/:id/comments` (gated by `canComment`); `PUT /api/artifacts/:id/policy` (**revocation** — `canManagePolicy`, owner-only); `POST /api/artifacts/:id/share-links` (locator only); **share-link redemption** route (re-evaluates policy live — links are not bearer tokens); `GET /api/artifacts/:id/download` (**presigned GET from Tigris/MinIO**, browser path only — never MCP).
- **Admin** (`/api/admin/*`, API audience + `role=admin`): invitations create/list, invitation accept, users list/promote/demote/deactivate/corrective-group-change, groups create/rename. All admin mutations write an `AdminAuditLog` ([`10`](../architecture/10-observability.md)).
- Not built here (see decision #41, [`01`](../architecture/01-overview.md)): the create/finalize endpoints backing the MCP publish path move to Phase 4 — their only caller is `publish_artifact`, and `09`'s BDD mapping already tests that flow at the MCP layer. Also not built: the optional single-link `POST .../share-links/:linkId/revoke` (`06` §4 marks it optional; the policy stays authoritative either way).

**Tests:** integration per endpoint; emphasise revocation flipping a previously-allowed viewer to denied, immutable-groups on accept, and audit rows.

**Acceptance:** full `/api/*` behaves per `06`; revocation is instant; admin actions audited and unreachable by MCP-audience tokens.

---

## Phase 4 — MCP surface ([`05`](../architecture/05-mcp-server-design.md))

**Goal:** agents can publish/discover/fetch/comment/share over `/mcp`.

- Replace the [`server.ts`](../../apps/backend/src/adapters/mcp/server.ts) placeholder with `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport` + `McpServer`, behind the Phase-1 auth middleware (MCP audience).
- Backend create/finalize endpoints that **back `publish_artifact`** (upload correlation via `bytesRef`) — moved here from Phase 3 (decision #41, [`01`](../architecture/01-overview.md)); build them alongside the tool that's their only caller.
- **Tools** (metadata-only results): `publish_artifact`, `list_artifacts`, `list_shared_with_me` (all rows; first 10 as a markdown table), `get_artifact` (small inline / else pointer), `comment_on_artifact`, `create_share_link`, `set_access_policy`. **No admin tools** (R3).
- **Resource** `artifact://<id>` — the only byte path; server-side GetObject; writes an `AccessEvent`.
- **Prompt** `summarise_artifact_reviews` — injects comments, no server-side LLM call.
- Every tool description follows the **`mcp-tool-descriptions`** skill.
- **Bruno collection** for manual token mint + `/mcp` calls ([`bruno-mcp-token.md`](bruno-mcp-token.md)).

**Tests:** MCP layered ([`09`](../architecture/09-testing-strategy.md) §4) — in-memory SDK (results metadata-only; table shape; resource blob+mimeType; prompt injection; owner-only policy) + HTTP black-box with a minted token (JSON-RPC envelopes; files come back as Resources, never tool results).

**Acceptance:** all `05` §7 requirement rows satisfied; files only ever via the Resource; revocation applies to the agent path.

---

## Phase 5 — Invitation flow + external services ([`02`](../architecture/02-auth-identity-and-admin.md) §4/§6)

**Goal:** admin-invite onboarding works reliably.

- **Transactional outbox** + idempotency worker (in-process poller): domain change + outbox row in one tx; worker drains → Resend (SMTP) + Auth0 **Management API** (create/enable user).
- Wire the **M2M creds** (`AUTH0_MGMT_CLIENT_ID/SECRET`, already in [`env.ts`](../../apps/backend/src/env.ts) as optional) — assert present before calling the Management API. Confirm the M2M app has `create/read/update:users` scopes.
- Dev email lands in **MailCatcher** (invites/notifications); magic-link email is Auth0's (not caught).

**Tests:** unit (outbox idempotency / no double-send); integration (invite → outbox row → accept provisions user + immutable groups).

**Acceptance:** invite → email → accept → provisioned active user with correct role/groups; retries don't double-send.

---

## Phase 6 — Frontend ([`../frontend/`](../frontend/), skills: `frontend-patterns`, `frontend-component-testing`)

**Goal:** the consuming/managing SPA (no publish UI).

- **Auth0 wiring**: add `@auth0/auth0-react`; `Auth0Provider` from `VITE_AUTH0_*`; Authorization Code + PKCE; attach access token (API audience) to API calls; guard admin routes.
- **API client** + Redux Toolkit slices/queries typed against `packages/contracts`.
- **Views**: Dashboard, My Artifacts, Shared With Me (incl. `sinceHours=24`), Artifact detail (viewer + download gated on `canView`, comments), policy/revoke form, Admin users/groups. **No publish/upload screen.**
- All feedback via the notifications slice + `NotificationRegion` / in-DOM modals.

**Tests:** React Testing Library component tests (`*.test.tsx`) per `09` §5 — accessible queries, Redux `<Provider>` + router, assert in-DOM notifications; mock the API layer.

**Acceptance:** login → browse/consume/manage works against the local backend; admin area gated; component tests green.

---

## Phase 7 — Search & filtering

**Goal:** the discovery UX [`docs/frontend/02-filtering-and-search.md`](../frontend/02-filtering-and-search.md)
describes, actually backed by the API. Phase 6 shipped `My Artifacts`/`Shared With Me` as plain
paginated lists (`scope` + `sinceHours` only) — this phase is the deferred faceted search on top.

- **Backend:** extend `GET /api/artifacts` to accept the rest of `ArtifactListQuery`
  (`packages/contracts/src/artifact.ts`) — `q` (full-text across `title`/`description`/`fileName`/
  `tags`), `contentType`/`kind`/`tags`/`sourceTool` facets, and `sort`. Applies to both
  `scope=mine` and `scope=sharedWithMe`. Index the faceted columns (`02 §4`: "faceted fields are
  indexed") — a new Prisma migration for indexes on `contentType`, `kind`, `publishedAt`/
  `createdAt`, `ownerId`, and the `Tag`/`ArtifactTag` join.
- **Frontend:** a debounced search box + facet controls (file type, kind, published-date range,
  publisher, tags, source tool, audience, access state) + sort dropdown on `MyArtifactsPage`/
  `SharedWithMePage`, replacing the plain-list version. Active filters reflected in the URL
  (shareable/bookmarkable, `02 §2`).
- **Tests:** API integration tests per facet + combinations of facets; component tests asserting
  the filter controls produce the expected query params.
- **Acceptance:** `02`'s full filter table works end to end; results still always pass per-item
  `canView` (already true — no change to that invariant, just breadth of *what's listed*).

---

## Cross-cutting: definition of done per phase

- `yarn lint && yarn typecheck && yarn test` green (the CI gate).
- New request/response shapes live in `packages/contracts` (rebuilt).
- New DB shape via a **new** migration (expand/contract); seed still idempotent.
- Behaviour matches the referenced design doc; deviations logged in [`01`](../architecture/01-overview.md).
- Use the **`verify`** skill on non-trivial slices (drive the flow, don't just run tests).

## Suggested first session

Phase 0 → Phase 1 (auth middleware + test-token endpoint + tests) → Phase 2 (first read routes). That
delivers a demonstrable, tested login→protected-API path and unblocks everything else.
