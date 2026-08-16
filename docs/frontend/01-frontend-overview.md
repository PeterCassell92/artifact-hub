# 01 — Frontend Overview & Views

*Status: design. Related: [`README.md`](README.md),
[`../architecture/06-api-design.md`](../architecture/06-api-design.md),
[`../architecture/02-auth-identity-and-admin.md`](../architecture/02-auth-identity-and-admin.md),
[`02-filtering-and-search.md`](02-filtering-and-search.md).*

---

## 1. What a user expects on arrival

1. **Sign in first** — no anonymous access. The landing prompt asks for the user's **email**;
   they receive a **magic link** (passwordless) and click it to authenticate. No password field,
   no sign-up (accounts exist only via admin invitation — see auth doc).
2. After sign-in they land on the **Dashboard**, whose job is to get them to **their artifacts**
   and **artifacts shared with them**, quickly.

If a user arrives via a **share link** (`/s/<token>`) while signed out, they are sent through the
magic-link sign-in and then redirected straight to that artifact's detail view.

## 2. Route map

| Route | View | Who |
|-------|------|-----|
| `/login` | Email → magic-link prompt | anyone (unauthenticated) |
| `/` (Dashboard) | Overview: recent My Artifacts + recent Shared With Me + quick filters/search | member+ |
| `/get-started` | Connect Claude Code / Claude Desktop to the MCP server (`/mcp` URL, CLI command, config snippet) — this, not the SPA, is how artifacts get published | member+ |
| `/artifacts` | **My Artifacts** — everything I own | member+ |
| `/shared` | **Shared With Me** — artifacts others shared to me/my groups | member+ |
| `/artifacts/:id` | **Artifact detail** — view/download, comments, share, policy | member+ (per `canView`) |
| `/s/:token` | Share-link redemption → resolves + redirects to `/artifacts/:id` | member+ after login |
| `/admin` | Admin dashboard | admin |
| `/admin/users` | Manage/invite users, promote/demote admins | admin |
| `/admin/groups` | Manage groups | admin |

**No `/publish` / upload route** — publishing is MCP-only (see README).

## 3. Dashboard

- Greets the user; surfaces **recently published (mine)** and **recently shared with me**.
- Prominent **search** box and the primary **filters** (see `02-filtering-and-search.md`).
- Empty state for a brand-new member explains that artifacts are published via their agent
  (Claude Desktop) using Artifact Hub's MCP tools — the UI is for viewing and managing.

## 4. My Artifacts (`/artifacts`)

- Lists artifacts where I am the **owner** (I always retain access, even after expiry — the owner
  short-circuit in arch/03).
- Each row shows: title, **filetype**, **published date**, audience summary (public / N users /
  groups), **expiry state** (active / expires in … / expired), comment count.
- Actions per artifact (owner-only): open detail, **manage access policy** (change audience/expiry
  = revoke), **create/revoke share link**.
- Filter/search/sort per `02-filtering-and-search.md`.

## 5. Shared With Me (`/shared`)

- Lists artifacts shared **to** me — directly (`specific_users`) or via my **groups**
  (`user_groups`), and `public_authenticated` ones surfaced as appropriate.
- Each row shows: title, filetype, **publisher name** (rectified from `ownerId`), published date,
  and when access will expire.
- Mirrors the MCP `list_shared_with_me` capability (incl. a "last 24 hours" quick filter).
- Opening a row goes to artifact detail (subject to `canView` re-evaluation — expired/revoked
  items are hidden or show an access-ended state).

## 6. Artifact detail (`/artifacts/:id`)

Gated by `canView`. Shows:

- **Viewer/preview** appropriate to the type (PDF inline, image render, HTML in a **sandboxed
  iframe** off the sandbox origin — arch/03 §7 — Mermaid/Markdown rendered), plus **Download**.
- **Metadata panel** — filetype, size, published date, publisher, tags, kind, source tool, and
  other captured metadata (see `../models/artifact.md`).
- **Comments** — list with **body, author name, date**; an add-comment box (requires view
  permission; always authenticated).
- **Owner controls** (only if I own it): **access policy editor** (audience + expiry buckets
  24h/7d/30d/never → revocation), **share-link** create/copy/revoke.
- Every view/download here is recorded as an **AccessEvent** (`route=ui`) — see
  `../models/access-event.md`.

## 7. Admin area (`/admin`)

Admin-only (see `../architecture/02-auth-identity-and-admin.md` §7):

- **`/admin/users`** — list users (email, name, status, role, groups); **invite** (email + role +
  group(s)); **promote a member to admin / demote**; corrective group change; deactivate.
- **`/admin/groups`** — list/create/rename groups.

## 8. Cross-cutting UX

- **Auth gating**: unauthenticated → `/login`; non-admins never see admin nav.
- **Expiry/revocation** is honoured live — the server re-evaluates `canView` on each request, so a
  now-expired artifact shows an "access ended" state rather than stale content.
- **Loading/empty/error** states everywhere; the "you have no artifacts yet — publish via your
  agent" empty state reinforces the MCP-only publish model.
- Components are unit-tested as `*.test.tsx` (see `../architecture/09-testing-strategy.md` §5).
