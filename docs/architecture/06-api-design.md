# 06 — REST API Design

*Status: design. Related: [02](02-auth-identity-and-admin.md),
[03](03-authorization-and-access-control.md), [04](04-data-model.md).*

The REST API is the HTTP adapter that serves the SPA (including the admin area) over the same
`core` domain layer as the MCP server. Framework: **Express** with **zod** request validation.

---

## 1. Conventions

- Base path **`/api`**. JSON in/out. `application/json` unless streaming a download.
- **Auth**: every route except the share-redemption bootstrap and health requires a valid Auth0
  bearer token (see `02`). A shared middleware resolves the token → `users` row and attaches it.
  `/api/*` accepts **only the API audience** — **MCP-audience tokens are rejected** (`02` §1.2).
  A token with no provisioned `users` row, or `status != active`, is denied (never auto-provisioned).
- **Admin routes** (`/api/admin/*`): require the **API audience** **and** `role=admin` — so an MCP
  token structurally cannot reach user-management (`02` §7). No admin action is exposed over MCP.
- **Validation**: zod schema per route; invalid input → `400` with a structured error.
- **Authorization**: route handlers call `core` authz functions (`03`); never re-implement checks.
- **Pagination**: cursor-based (`?cursor=&limit=`), `limit` default 20 / max 100.
- **Error contract**:
  ```json
  { "error": { "code": "forbidden", "message": "…", "details": { } } }
  ```
  Codes: `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `rate_limited`,
  `internal`. HTTP status mirrors the code.

---

> **Publishing is MCP-only.** There is **no create/upload route exposed to the SPA** — new
> artifacts are created exclusively through the MCP `publish_artifact` path (see `05`). The
> `POST /api/artifacts` + `finalize` endpoints below back **that agent publish flow** (or an
> internal `core` call), not a frontend screen. The SPA is view/manage only.

## 2. Artifact routes

| Method & path | Purpose | Authz |
|---------------|---------|-------|
| `POST /api/artifacts` | (MCP publish path) Create artifact metadata + policy; returns a **presigned PUT** for the body | authenticated (becomes owner) |
| `POST /api/artifacts/:id/finalize` | (MCP publish path) Confirm upload complete (size/mime/checksum recorded) | owner |
| `GET /api/artifacts/:id` | Artifact detail (metadata + policy + can-I-view). **Records an AccessEvent** (`route=ui`, `view`) | `canView` |
| `GET /api/artifacts` | List artifacts visible to me (filters: `mine`, `sharedWithMe`, `sinceHours`, plus search/facets — see frontend/02) | per-item `canView` |
| `GET /api/artifacts/:id/download` | Mint ~60s presigned URL and `302` redirect. **Records an AccessEvent** (`route=ui`, `download`) | `canView` |
| `PUT /api/artifacts/:id/policy` | Change audience + expiry (**revocation**). Writes `AdminAuditLog` `policy.update` | owner (`canManagePolicy`) |
| `GET /api/artifacts/:id/access-events` | Access history for an artifact (audit trail) | owner (or admin) |
| `GET /api/artifacts/:id/relationships` | List related artifacts | `canView` |
| `POST /api/artifacts/:id/relationships` | Link a relationship (supersedes/derived_from/related_to) | owner |

`GET /api/artifacts?sharedWithMe=1&sinceHours=24` mirrors the MCP `list_shared_with_me` and
uses the `ArtifactAllowedUser(userId)` / `ArtifactAllowedGroup(groupId)` indexes (`04` §4). The
list endpoints also accept `q` (search) and the facet filters defined in
[`../frontend/02-filtering-and-search.md`](../frontend/02-filtering-and-search.md).

**Access auditing:** every view/download here — and every share-link redemption (`§4`) and MCP
resource read (`05`) — writes an `AccessEvent` capturing the **route** (`ui` / `share_link` /
`mcp`), `action`, and `decision` (allowed **or** denied). See [`../models/access-event.md`](../models/access-event.md).

## 3. Comment routes

| Method & path | Purpose | Authz |
|---------------|---------|-------|
| `GET /api/artifacts/:id/comments` | List comments (body, author name, createdAt) | `canView` |
| `POST /api/artifacts/:id/comments` | Add a comment | `canComment` (= `canView` + authed) |

## 4. Share-link routes

| Method & path | Purpose | Authz |
|---------------|---------|-------|
| `POST /api/artifacts/:id/share-links` | Mint a locator link `/s/<token>` | `canView` (not owner-only — see below) |
| `GET /api/s/:token` | Redeem: resolve token → require auth (magic link) → `canView` → `302` to presigned URL (or artifact detail). **Records an AccessEvent** (`route=share_link`, with `shareLinkId`) | `canView` after login |
| `POST /api/artifacts/:id/share-links/:linkId/revoke` | Retire a single link (optional; policy still authoritative) | owner |

Redemption never trusts the token for access — it only locates the artifact; the current policy
decides (see `03` §5). Unauthenticated redeemers are redirected to login, then back.

Minting a link only requires `canView`, not ownership: a share link is a pure locator that
carries no permission of its own (`03` §5), so a non-owner viewer handing the link to someone else
can never grant more access than the redeemer's own `canView` check allows on redemption. The
owner is the only one who can *change* the policy (`03` §1) — a viewer minting a link doesn't touch
it.

## 5. Admin routes (role = `admin`)

| Method & path | Purpose |
|---------------|---------|
| `GET /api/admin/users` | List users (status, role, groups) |
| `POST /api/admin/invitations` | Invite `{ email, role, groupIds[] }` → creates invite + outbox Resend send |
| `POST /api/admin/users/:id/groups` | Corrective group change (audit-logged) |
| `POST /api/admin/users/:id/role` | Change role |
| `POST /api/admin/users/:id/disable` | Deactivate a user |
| `GET /api/admin/groups` / `POST /api/admin/groups` | List / create groups |

## 6. Invitation acceptance (unauthenticated bootstrap)

| Method & path | Purpose |
|---------------|---------|
| `GET /api/invitations/:token` | Validate token, return invite preview (email, groups) |
| `POST /api/invitations/accept` | Accept: create Auth0 user, create `users` row + memberships, mark accepted |

## 7. Health

| Method & path | Purpose |
|---------------|---------|
| `GET /healthz` | Liveness (process up) |
| `GET /readyz` | Readiness (DB reachable, migrations applied) — used by the Fly health check |

---

## 8. Upload flow (why presigned PUT)

```
SPA ─POST /api/artifacts {metadata, policy}─▶ Backend
     ◀─ { artifactId, uploadUrl (presigned PUT, ~60s) }
SPA ─PUT bytes ─────────────────────────────▶ Tigris   (direct, bypasses backend)
SPA ─POST /api/artifacts/:id/finalize ───────▶ Backend (record size/mime; ready)
```

Bytes go straight to Tigris; the backend never buffers large files. The MCP `publish_artifact`
uses the same mechanism.

---

## 9. HTML-artifact sandboxing (headers)

When serving/rendering an HTML artifact:

- Serve from a **dedicated sandbox origin** (the object store's own domain / a sandbox subdomain
  over the Tigris origin), never the app origin.
- Response headers:
  - `Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox`
    (tuned per need; start restrictive).
  - `X-Content-Type-Options: nosniff`
  - `Content-Disposition` set appropriately (inline vs attachment).
- The SPA embeds such artifacts in a sandboxed `<iframe>` pointing at the sandbox origin, so any
  script cannot touch the app's session/DOM/cookies.

---

## 10. CORS

The SPA (**Netlify** origin) and the API (**Fly** origin) are separate origins → configure CORS on
`/api/*` to allow the SPA origin, credentials, and the needed methods/headers. `/mcp` is called
by MCP clients (not browsers) and is not CORS-scoped the same way.

---

## 11. Shared contracts

Request/response types live in `packages/contracts` (see `08`) and are imported by both the
backend and the SPA, so the API contract is type-checked on both sides.
