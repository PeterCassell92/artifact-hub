# 02 — Identity, Authentication & Admin

*Status: design. Related: [01](01-overview.md), [03](03-authorization-and-access-control.md),
[04](04-data-model.md), [06](06-api-design.md), [07](07-infrastructure-and-iac.md).*

Covers **who** a caller is (authentication) and **how users are onboarded**. Authorization
(what a caller may do) is in `03`.

---

## 1. Auth0 — one IdP, two OAuth roles

Auth0 is the single identity provider. It serves two distinct roles against the **same**
user directory (each user keyed by Auth0 subject `idp_sub`):

> **One tenant per environment.** "Single IdP" means one *product*, not one tenant — Auth0 is split
> into a **`ArtifactHub-Dev`** tenant and a **`ArtifactHub-Prod`** tenant, so dev testing never
> touches production users, apps, or connections. **Both OAuth roles (A and B) live together in one
> tenant *within* an environment** — the split is across environments, not across roles. Each tenant
> has its own domain, SPA app (client id), API audiences, callback/logout URLs, and Management API
> creds; the `AUTH0_*` / `VITE_AUTH0_*` env values differ per environment accordingly. When setting
> up **`ArtifactHub-Dev`**, only the **localhost** callback/logout/web-origin URLs are needed
> (`http://localhost:5173`); the Netlify/custom-domain URLs belong to **`ArtifactHub-Prod`**.

### Role A — humans logging into the SPA (standard OIDC, **passwordless / magic link**)
- **No passwords anywhere.** Every human — members *and* admins — logs in with a **magic link**
  (passwordless email). We already run an email service (Resend) for invitations, so we reuse it for
  auth and avoid all password storage/reset/rotation burden.
- The SPA runs the **Authorization Code + PKCE** flow against Auth0; Auth0's **passwordless
  (email link)** connection is the credential — the user enters their email, receives a one-time
  sign-in link, and is authenticated.
- Auth0 issues an ID token + access token (audience = the Artifact Hub API).
- `/api/*` validates the access token (issuer, audience, signature via JWKS, expiry).
- Consequence: there is **no password field** in our system, no "set password" step, and no
  password-reset flow to build.

### Role B — Claude Desktop / MCP clients connecting to `/mcp`
- The MCP server is an OAuth **Resource Server**; the MCP client is the OAuth *client*;
  Auth0 is the *Authorization Server*.
- Requires **OAuth Protected Resource Metadata** (`/.well-known/oauth-protected-resource`)
  advertising the Auth0 authorization server, and **Dynamic Client Registration (DCR)** so
  clients can self-register.
- `/mcp` validates the bearer token with the **same signature/issuer checks** as `/api/*`, but
  each endpoint is a **distinct OAuth resource with its own audience** (see §1.2) — an MCP token is
  audience-bound to the MCP resource and is **not** accepted at `/api/*` (and vice-versa).

> ✅ **Verified (Auth0 live docs, Aug 2026).** Auth0 ships a first-class **"Auth for MCP"** product
> ([auth0.com/ai/docs/mcp](https://auth0.com/ai/docs/mcp/intro/overview)) covering exactly this flow:
> OAuth 2.1 + OIDC, **Dynamic Client Registration**, and the **RFC 8707 `resource` parameter**. The
> two things this depends on are **tenant toggles**, not a bespoke build — see *Auth0 tenant config*
> below. (Note: Auth0's OBO **Token Exchange** and **Token Vault** features are **not needed** here —
> those are for MCP servers that call a *separate* internal API or third-party SaaS; ours validates
> the token and runs the shared `core` layer directly.)

#### Auth0 tenant config for `/mcp` (verified — set these on each environment's tenant)

Step-by-step with exact navigation/labels: [`development/Auth0configuration.md`](../development/Auth0configuration.md).
Both are **Dashboard → Settings → [Advanced](https://manage.auth0.com/dashboard/#/tenant/advanced)** toggles:

1. **Dynamic Client Registration** (`enable_dynamic_client_registration`). Consequences to plan for:
   - DCR clients are **third-party applications** — they can only use **domain-level connections**, so
     the **passwordless email connection must be promoted to domain-level** or Claude can't show the
     magic-link login (R5).
   - You **cannot set per-app client grants during registration**, so configure **default permissions
     for third-party applications** on the MCP API up front, or DCR clients get no access.
   - The `/oidc/register` endpoint is rate-limited (5 req/s) and gate-able via the tenant ACL — fine
     for our volume.
2. **Resource Parameter Compatibility Profile** (+ **Include Issuer in Authorization Responses**).
   MCP clients (Claude) send the RFC 8707 **`resource`** param and **no `audience`**; with this
   **off**, Auth0 ignores `resource` and issues an **opaque token** the RS can't validate. With it
   **on**, Auth0 maps `resource` → the token's `aud`, which is what R2 checks. The MCP API's
   identifier **must be an absolute URI** (we use `https://mcp.artifact-hub.example`) — required by
   both RFC 8707 and the MCP spec. (If both `resource` and `audience` are sent, `audience` wins.)

> Verify these are available on the tenant's plan (paid tier acceptable — see project decision) and
> re-apply them on **both** `ArtifactHub-Dev` and `ArtifactHub-Prod`.

**Token validation is shared middleware** (same JWKS/issuer/expiry logic) used by both adapters,
parameterised by the **expected audience** per endpoint. It resolves the Auth0 `sub` to a local
`users` row. **Provisioning happens only at invitation accept (§4) — login/token validation NEVER
creates a user.** If there is no matching `users` row, or `status != active`, the request is
**denied** (see §1.1, R1/R4).

### Sequencing
Build Role A first (app login + protected API), then layer the MCP resource-server metadata
onto the same Auth0 tenant (the environment's tenant — both roles share it; see the per-environment
tenant note above).

---

## 1.1 MCP authentication flow (Role B) — step by step

MCP client = Claude Desktop; Resource Server (RS) = our `/mcp`; Authorization Server (AS) = Auth0.

**Discovery**
1. Claude makes an **unauthenticated** request to `/mcp`.
2. RS replies **`401`** with `WWW-Authenticate` pointing at our **Protected Resource Metadata**
   (`/.well-known/oauth-protected-resource`, RFC 9728).
3. Claude reads the PRM → learns the **AS** (Auth0) and the **resource identifier (audience)** to
   request a token for.
4. Claude reads Auth0's **AS metadata** (`/.well-known/openid-configuration`) → `authorize`,
   `token`, `registration`, JWKS endpoints.

**Registration (first time only)**
5. Claude **self-registers** via **Dynamic Client Registration** (RFC 7591) → gets a `client_id`.
   *(Requires the DCR tenant toggle; see Auth0 tenant config above.)*

**Authorization**
6. Claude runs **Authorization Code + PKCE**, opening the **system browser** to Auth0's
   `authorize` endpoint with a **resource indicator** (RFC 8707) naming our MCP resource.
   *(Auth0 honours `resource` only with the Resource Parameter Compatibility Profile enabled;
   see Auth0 tenant config above — otherwise the token comes back opaque and step 11 fails.)*
7. The user authenticates via the **passwordless magic link** and consents. *(This is the intended
   UX — the magic-link login happens inside the OAuth popup/browser.)*
8. Auth0 redirects to Claude's **loopback redirect URI** with an authorization code.
9. Claude exchanges `code` + PKCE verifier at the `token` endpoint → **access token** (+ refresh),
   `aud` = our MCP resource.

**Calling & validation**
10. Claude calls `/mcp` with `Authorization: Bearer <token>`.
11. RS validates: JWKS signature, `iss`, **`aud` = MCP resource** (reject otherwise), expiry →
    resolves `sub` → local `users` row → checks `status = active`.
12. Each tool/resource call then runs object-level authz (`canView`/`canComment`/`canManagePolicy`,
    `03`). Refresh handled client-side on expiry.

### Firm rules (R1–R5) — these make the flow safe and admin-controlled
- **R1 — Deny if not provisioned.** The user set is **admin-controlled** (invite-only). A valid
  Auth0 token whose `sub`/email has **no provisioned `users` row is denied** at the RS. The MCP
  path **never auto-provisions**. (Also: disable open sign-up on the Auth0 passwordless connection
  so un-invited emails can't even obtain a token.)
- **R2 — Reject non-audience-bound tokens.** A token is accepted at `/mcp` only if its `aud` is our
  **MCP resource** (RFC 8707). This prevents token pass-through / confused-deputy replay of a token
  minted for another audience.
- **R3 — Identity-only tokens; no admin over MCP.** Tokens carry **identity, not fine-grained
  scopes**. An agent may do **everything the human member can do** (publish, view per policy,
  comment, share, manage its own artifacts' policy) — **except any admin / user-management action**.
  Those are **human-UI only**: **no admin/user-management MCP tools exist**, and `/api/admin/*`
  accepts **only the API audience**, so an MCP-audience token structurally cannot reach admin
  routes. See §7 and `05`.
- **R4 — Disabled users are blocked immediately.** Because the RS resolves `sub → users` and checks
  `status = active` on **every** request, a **disabled user is denied even with a still-valid Auth0
  token** — no waiting for token expiry.
- **R5 — Passwordless in the OAuth popup.** The sanctioned login UX: the OAuth browser step shows
  Auth0 Universal Login using the **magic-link passwordless** connection. *(Verify end-to-end in
  Claude Desktop, like the base64/mime check in `05`.)*

## 1.2 Two OAuth resources (audiences)

| Endpoint | OAuth resource / audience | Obtained by | Admin routes? |
|----------|---------------------------|-------------|---------------|
| `/api/*` | **API audience** | SPA (Auth0 OIDC, Role A) | `/api/admin/*` — admin role required |
| `/mcp`   | **MCP audience** | MCP client (Role B, §1.1) | **never** — MCP tokens rejected at `/api/*` |

The two audiences are the enforcement mechanism for R3: admin/user-management lives only under
`/api/admin/*`, which requires the API audience **and** `role=admin`; MCP tokens (MCP audience)
are rejected there before any handler runs.

---

## 2. Roles & the user record

Every actor is a `users` row (see `04`). Two app roles:

- **`member`** — default. Can **view** (per policy), **comment**, **share**, and **manage the
  access policy of** their own artifacts through the frontend. **Publishing (creating new
  artifacts) is done only via the MCP agent, not the frontend** — see `05` and the frontend
  scope in [`../frontend/`](../frontend/).
- **`admin`** — everything a member can do, **plus** the admin area: invite/manage users,
  **promote an existing user to admin** (and demote), and manage groups.

`role` is stored on the `users` row and asserted from the DB (not from token claims), so it
cannot be spoofed by a manipulated token. A user's role is set at invite time and changed
only by an admin (see §7, promote/demote).

---

## 3. Groups (app-managed, immutable to the user)

- Groups (`groups`) and membership (`group_memberships`) live in **Postgres**, not Auth0.
- Membership is **assigned by an admin at invite time** and is **immutable by the user** —
  there is deliberately **no** self-service route to change one's own groups. This guarantees
  a user cannot escalate their own access to group-restricted artifacts.
- Changing a user's groups (rare, corrective) is an **admin-only** operation and is audit-logged.
- Rationale for app-managed vs. Auth0 Organizations/Roles: self-contained, trivially testable
  locally, no IdP coupling. A future production system could migrate to Auth0 Organizations;
  that is explicitly deferred.

---

## 4. Invitation lifecycle (admin-driven onboarding)

Because there are no anonymous users and no open sign-up, **every** account originates from an
admin invitation. Flow:

```
Admin (in /admin/users)
   │  POST /api/admin/invitations { email, role, groupIds[] }
   ▼
Backend: create `invitations` row
   • token = random; store token_hash only; expires_at (e.g. +7d); status=pending
   • record email, role, groupIds, invited_by
   │  (transactional outbox row enqueued)
   ▼
Resend: send email with link  https://<app>/accept-invite?token=<token>
   ▼
Invitee opens link → SPA accept page (confirms name; NO password to set)
   ▼
Backend accept: POST /api/invitations/accept { token }
   • validate token_hash, not expired, status=pending
   • create/enable the Auth0 user for this email (passwordless connection; Management API)
   • create the app `users` row (role from invite, status=active)
   • insert `group_memberships` for each invited groupId (immutable thereafter)
   • mark invitation status=accepted, accepted_at=now
   ▼
Invitee signs in via magic link (Role A) → provisioned user, correct groups
```

Because auth is passwordless, accepting an invitation sets **no password** — it verifies the
email, provisions the account + groups, and the user thereafter signs in via magic link. (The
invitation email itself can double as the first magic-link sign-in.)

Notes:
- The **invitation is the source of truth** for role + group assignment.
- Token: store only `token_hash` (e.g. SHA-256); the raw token exists only in the emailed link.
- Re-invite / resend is idempotent per pending invitation; accepting is single-use.
- Auth0 user creation uses the **Management API** with credentials from `fly secrets`. The
  cross-service hop (Auth0 + Resend) is made reliable by the **transactional outbox + idempotency**
  pattern (see §6), not an agentic framework.

---

## 5. Initial-admin bootstrap (breaks the chicken-and-egg)

Admins invite everyone — so the **first** admins are seeded by infrastructure, not invited
in-app.

- Config **`INITIAL_ADMIN_EMAILS`** — a **comma-separated list** — supplied as a `fly secret`
  (dev: `.env`).
- On first deploy, an **idempotent `prisma db seed`** step:
  1. Seeds the initial groups (e.g. `Product`, `Development`).
  2. Creates **one admin `users` row per listed email** (`role=admin`, `status=invited`).
  3. Fires the same **Resend invitation** to each, so each seed admin signs in via magic link
     exactly like any other user (no password).
- **Idempotent**: re-running the seed skips emails/groups that already exist, so the step is
  safe to leave in the deploy pipeline.
- After first login, seeded admins invite everyone else through `/admin/users`. Because
  **invitations carry a `role`**, admins can mint further admins — the seed is one-time only.

---

## 6. Cross-service reliability — transactional outbox + idempotency

Invitation accept and publish both touch external systems (Auth0, Resend, Tigris). To avoid partial
failures without a heavyweight orchestrator:

- Write the domain change **and** an `outbox` row in the **same DB transaction**.
- A worker (in-process interval or a small poller) drains the outbox and performs the external
  call (send email via Resend, call Auth0), marking the row done on success, retrying with backoff on
  failure.
- External calls carry an **idempotency key** (e.g. invitation id) so retries don't double-send
  or double-create.

This keeps the backend deterministic and free of LLM/agent-graph machinery (no LangGraph).

---

## 7. Admin area (`/admin`)

**Admin / user-management is a human-UI function only.** It is **not** exposed over MCP: there are
**no admin/user-management MCP tools**, and `/api/admin/*` accepts **only the API audience** and
requires `role=admin`, so an MCP-audience token is rejected before any admin handler runs (R3 §1.1).

Frontend routes (SPA), all gated to `role=admin`:

- **`/admin`** — landing/dashboard.
- **`/admin/users`** — list users; **invite** (email + role + group(s)); view status
  (invited/active); **promote a member to admin / demote an admin to member**; corrective group
  change; deactivate.
- **`/admin/groups`** — list/create groups (v1: create + rename; membership managed via invites
  / corrective edits).

### Promote / demote (existing users)
Promoting an existing member to `admin` (or demoting) is a first-class admin action:
`POST /api/admin/users/:id/role { role }` (see `06`). It updates the `users.role` column and is
**audit-logged** (`role.change`, with actor + target). Because `role` is read from the DB per
request, the change takes effect on the target's next request — no re-invite needed. Guardrails:
an admin cannot demote themselves if they are the last remaining admin (prevents lock-out).

Backing API routes are specified in `06` (`/api/admin/*`). All admin mutations are
**audit-logged** (see `10`): who invited/promoted/demoted whom, into which groups.

---

## 8. Security notes

- Role and group membership are read from the **database**, never trusted from token claims.
- **Admin-controlled user set (R1)**: no open sign-up; a token with no provisioned `users` row is
  denied; the MCP path never auto-provisions.
- **Audience-bound tokens (R2)**: `/mcp` accepts only MCP-audience tokens; `/api/*` only
  API-audience tokens; `/api/admin/*` additionally requires `role=admin` — MCP tokens can't reach it.
- **No admin over MCP (R3)**: user-management is human-UI only; no admin MCP tools exist.
- Invitation tokens: hashed at rest, single-use, time-boxed.
- Auth0 Management API credentials and the Resend API key live in **`fly secrets`**; Fly injects
  them into the machine (no cloud IAM role).
- **Passwordless**: no password field in our DB and none in Auth0 — sign-in is via magic link, so
  there is no password store, reset flow, or credential-stuffing surface. Magic-link tokens are
  short-lived and single-use (handled by Auth0's passwordless connection).
- **Disabled users blocked immediately (R4)**: authz is re-evaluated every request against DB
  `status`, so deactivation takes effect on the next request even if the Auth0 token is still valid.
