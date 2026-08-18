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
| `/get-started` | Connect Claude Code / Claude Desktop to the MCP server (`/mcp` URL, CLI command, config snippet) — one of the two ways to publish, alongside the Dashboard's Publish New Artifact modal | member+ |
| `/artifacts` | **My Artifacts** — everything I own | member+ |
| `/shared` | **Shared With Me** — artifacts others shared to me/my groups | member+ |
| `/artifacts/:id` | **Artifact detail** — view/download, comments, share, policy | member+ (per `canView`) |
| `/artifacts/:id/complete-upload` | **Upload completion** — finishes an MCP-started publish in the browser (arch `01` decision #47): file picker only, since metadata + policy were already set by `publish_artifact`; re-mints a fresh presigned PUT, uploads, finalizes. Reached via the tool's `webUploadUrl`; also resumes any abandoned pending upload | member+ (owner only — non-owners get an inline denial) |
| `/s/:token` | Share-link redemption → resolves + redirects to `/artifacts/:id` | member+ after login |
| `/admin` | Admin dashboard | admin |
| `/admin/users` | Manage/invite users, promote/demote admins | admin |
| `/admin/groups` | Manage groups | admin |

**No dedicated `/publish` route** — publishing from the UI happens via a modal on the Dashboard
(`/`), not a separate route; agents can still publish via MCP `publish_artifact` (see README).
`/artifacts/:id/complete-upload` doesn't change this: it only *finishes* a publish that
`publish_artifact` already started, it can't start one.

## 3. Dashboard

- Greets the user; surfaces the **3 most recent** My Artifacts and the **3 most recent** Shared
  With Me, each with a "View all" link to the full `/artifacts` / `/shared` page.
- A full-width **"Publish New Artifact"** button under My Artifacts opens a two-step modal: step 1
  picks a file (a dashed drop-tile with a plus icon; clicking anywhere opens the native file
  picker; once chosen, shows name/size/type — a file over the **500MB** cap shows an inline error
  and blocks Next; the backend enforces the same cap on finalize, see arch `05`/`06`), step 2 sets
  the access policy (same audience/expiry fields as the artifact detail page's editor, including
  the "Specific people" combo box). Title is always the file's name. On success the modal closes
  and the list refetches.
- Prominent **search** box and the primary **filters** (see `02-filtering-and-search.md`).
- Empty state for a brand-new member explains they can publish either by clicking "Publish New
  Artifact" or by asking their agent (Claude Desktop) via Artifact Hub's MCP tools.

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
- **Metadata panel** — filetype, size, **published date and time**, publisher, tags, kind, source
  tool, and other captured metadata (see `../models/artifact.md`).
- **Comments** — list with **body, author name, date**; an add-comment box (requires view
  permission; always authenticated).
- **Access policy panel** — shown to every viewer, not just the owner:
  - **Owner**: an editable **access policy editor** (audience + expiry buckets 24h/7d/30d/never,
    each computed relative to the artifact's **published date/time**, not to when it's edited —
    an info tooltip on the Expiry control says so). The "Specific people" audience is a **combo
    box of real users** (checked from `GET /api/users`), never free text — same for "Groups"
    (`GET /api/groups`); at least one person/group must be selected before saving. Selecting a
    bucket shows the resulting expiry
    date/time as inline info text below the field, live, before saving. If that computed date has
    already passed (relative to publish), inline warning text also appears, since saving would
    immediately deny everyone but the owner. A **"Revoke all access"** button (red, confirm dialog) sits
    next to Save — an instant, whole-artifact cutoff independent of the audience/expiry fields
    (arch/03 §1a). Once revoked, the fields and Save button are disabled, a **"Revoked"** status
    shows, and the button becomes **"Re-open Access"** (unlocks the fields for editing; nothing
    is persisted until Save is clicked again, which flips status back to **"Accessible"**).
  - **Non-owner viewer**: a **read-only** summary of the same audience/expiry — they can see the
    policy but can't change it (arch/03 §1 — owner-only).
  - **Share link** create/copy — any viewer who can currently view the artifact can mint one
    (arch/03 §1, §5), not just the owner; it's a pure locator, never more permissive than the
    redeemer's own access.
- Every view/download here is recorded as an **AccessEvent** (`route=ui`) — see
  `../models/access-event.md`.
- **Access History panel** — owner or admin only (hidden entirely otherwise, gated on
  `ArtifactDetail.canViewAccessEvents`): who viewed/downloaded this artifact and when, including
  denied attempts (shown with their reason — e.g. revoked, expired, not in audience), newest
  first, cursor-paginated with a "Load more" button (same pattern as the My Artifacts/Shared With
  Me lists). Backed by `GET /api/artifacts/:id/access-events` — see `../models/access-event.md` §7.

## 7. Admin area (`/admin`)

Admin-only (see `../architecture/02-auth-identity-and-admin.md` §7). `/admin/users` and
`/admin/groups` render as **tabs of one shell** (`AdminPage`) rather than unrelated pages, so
adding further admin sections later is a new tab, not a new nav entry:

- **`/admin/users`** — list users (email, name, status, role, groups); **invite** (email + name
  (**required** — every user must have a display name) + role + group(s)) — the invitee's
  placeholder `users` row (status `invited`) appears in the list immediately, before they accept;
  **promote a member to admin / demote**; corrective group change; deactivate. An admin cannot
  demote or disable **their own** account (row shows "(you)" instead of actions) — server-enforced,
  not just hidden client-side.
- **`/admin/groups`** — list/create groups (no rename/delete in v1 — see decision log in
  `../architecture/01-overview.md`).

The **Admin nav entry** itself is not one of the left-hand navlinks — it renders as a light-blue
pill in the header, to the left of the signed-in user's name (their profile button — clicking it
opens a popover with email/groups/role), so it reads as a distinct "mode switch" rather than
another page in the primary nav.

## 8. Cross-cutting UX

- **Auth gating**: unauthenticated → `/login`; non-admins never see admin nav.
- **Expiry/revocation** is honoured live — the server re-evaluates `canView` on each request, so a
  now-expired artifact shows an "access ended" state rather than stale content.
- **Loading/empty/error** states everywhere; the "you have no artifacts yet" empty state now
  offers both publish paths (the Publish New Artifact button, and agent instructions).
- Components are unit-tested as `*.test.tsx` (see `../architecture/09-testing-strategy.md` §5).
