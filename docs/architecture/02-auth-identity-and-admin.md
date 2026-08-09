# 02 — Identity, Authentication & Admin

*Status: design. Related: [01](01-overview.md), [03](03-authorization-and-access-control.md),
[04](04-data-model.md), [06](06-api-design.md), [07](07-infrastructure-and-iac.md).*

Covers **who** a caller is (authentication) and **how users are onboarded**. Authorization
(what a caller may do) is in `03`.

---

## 1. Auth0 — one IdP, two OAuth roles

Auth0 is the single identity provider. It serves two distinct roles against the **same**
user directory (each user keyed by Auth0 subject `idp_sub`):

### Role A — humans logging into the SPA (standard OIDC)
- The SPA runs the **Authorization Code + PKCE** flow against Auth0.
- Auth0 issues an ID token + access token (audience = the Artifact Hub API).
- `/api/*` validates the access token (issuer, audience, signature via JWKS, expiry).

### Role B — Claude Desktop / MCP clients connecting to `/mcp`
- The MCP server is an OAuth **Resource Server**; the MCP client is the OAuth *client*;
  Auth0 is the *Authorization Server*.
- Requires **OAuth Protected Resource Metadata** (`/.well-known/oauth-protected-resource`)
  advertising the Auth0 authorization server, and **Dynamic Client Registration (DCR)** so
  clients can self-register.
- `/mcp` validates the bearer token **identically** to `/api/*` (same issuer/JWKS; audience
  may differ per Auth0 API definition).

> ⚠️ **Verify before building:** confirm **DCR is available on the Auth0 tier we use** — the
> MCP connection depends on it. (Auth0 reached GA MCP support ~May 2026; validate on the tenant.)

**Token validation is one shared middleware** used by both adapters → identical semantics.
The middleware resolves the Auth0 `sub` to a local `users` row (provisioning on first login
only if a matching accepted invitation exists — see §4).

### Sequencing
Build Role A first (app login + protected API), then layer the MCP resource-server metadata
onto the same Auth0 tenant.

---

## 2. Roles & the user record

Every actor is a `users` row (see `04`). Two app roles:

- **`member`** — default. Can publish, view (per policy), comment, share their own artifacts.
- **`admin`** — everything a member can do, **plus** the admin area: invite/manage users and
  manage groups.

`role` is stored on the `users` row and asserted from the DB (not from token claims), so it
cannot be spoofed by a manipulated token. A user's role is set at invite time and changed
only by an admin.

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
SES: send email with link  https://<app>/accept-invite?token=<token>
   ▼
Invitee opens link → SPA accept page → sets a password
   ▼
Backend accept: POST /api/invitations/accept { token, password | idp flow }
   • validate token_hash, not expired, status=pending
   • create/enable the Auth0 user (Auth0 Management API)
   • create the app `users` row (role from invite, status=active)
   • insert `group_memberships` for each invited groupId (immutable thereafter)
   • mark invitation status=accepted, accepted_at=now
   ▼
Invitee logs in via Auth0 (Role A) → provisioned user, correct groups
```

Notes:
- The **invitation is the source of truth** for role + group assignment.
- Token: store only `token_hash` (e.g. SHA-256); the raw token exists only in the emailed link.
- Re-invite / resend is idempotent per pending invitation; accepting is single-use.
- Auth0 user creation uses the **Management API** with credentials from Secrets Manager. The
  cross-service hop (Auth0 + SES) is made reliable by the **transactional outbox + idempotency**
  pattern (see §6), not an agentic framework.

---

## 5. Initial-admin bootstrap (breaks the chicken-and-egg)

Admins invite everyone — so the **first** admins are seeded by infrastructure, not invited
in-app.

- Config **`INITIAL_ADMIN_EMAILS`** — a **comma-separated list** — supplied as a Terraform var
  and stored in **Secrets Manager**.
- On first deploy, an **idempotent `prisma db seed`** step:
  1. Seeds the initial groups (e.g. `Product`, `Development`).
  2. Creates **one admin `users` row per listed email** (`role=admin`, `status=invited`).
  3. Fires the same **SES invitation** to each, so each seed admin sets their own password via
     Auth0 exactly like any other user.
- **Idempotent**: re-running the seed skips emails/groups that already exist, so the step is
  safe to leave in the deploy pipeline.
- After first login, seeded admins invite everyone else through `/admin/users`. Because
  **invitations carry a `role`**, admins can mint further admins — the seed is one-time only.

---

## 6. Cross-service reliability — transactional outbox + idempotency

Invitation accept and publish both touch external systems (Auth0, SES, S3). To avoid partial
failures without a heavyweight orchestrator:

- Write the domain change **and** an `outbox` row in the **same DB transaction**.
- A worker (in-process interval or a small poller) drains the outbox and performs the external
  call (send SES email, call Auth0), marking the row done on success, retrying with backoff on
  failure.
- External calls carry an **idempotency key** (e.g. invitation id) so retries don't double-send
  or double-create.

This keeps the backend deterministic and free of LLM/agent-graph machinery (no LangGraph).

---

## 7. Admin area (`/admin`)

Frontend routes (SPA), all gated to `role=admin`:

- **`/admin`** — landing/dashboard.
- **`/admin/users`** — list users; **invite** (email + role + group(s)); view status
  (invited/active); corrective group/role change; deactivate.
- **`/admin/groups`** — list/create groups (v1: create + rename; membership managed via invites
  / corrective edits).

Backing API routes are specified in `06` (`/api/admin/*`). All admin mutations are
**audit-logged** (see `10`): who invited whom, into which groups, and any role/group change.

---

## 8. Security notes

- Role and group membership are read from the **database**, never trusted from token claims.
- Invitation tokens: hashed at rest, single-use, time-boxed.
- Auth0 Management API credentials and the SES sender identity live in **Secrets Manager**;
  the ECS task role grants least-privilege access.
- No password handling in our DB — Auth0 owns credentials.
- Deactivating a user blocks new logins and strips their access on the next request (authz is
  re-evaluated every request).
