# 03 — Authorization & Access Control

*Status: design. This is the heart of the system. Related: [02](02-auth-identity-and-admin.md),
[04](04-data-model.md), [05](05-mcp-server-design.md), [06](06-api-design.md).*

Authentication (who the caller is) is in `02`. This document defines **what an authenticated
caller may do** with an artifact, and how revocation works.

---

## 1. The access policy (one per artifact)

Each artifact carries exactly **one** owner-controlled policy:

- **`audience_type`** — one of:
  - `public_authenticated` — any authenticated user.
  - `specific_users` — a listed set of users (`artifact_allowed_users`).
  - `user_groups` — members of a listed set of groups (`artifact_allowed_groups`).
- **`expiry`** — one of `24h`, `7d`, `30d`, `never`, stored as `expires_at` (a timestamp, or
  `NULL` for `never`). The buckets are a UI convenience; the stored value is the absolute
  timestamp computed at publish/policy-update time.

Only the **owner** can create or change the policy. There is no per-link policy; **share
links are pure locators** (see §5) — so *minting* a link is a separate, weaker permission than
*changing the policy*: any viewer who passes `canView` may mint one (§5), not just the owner.

---

## 2. The single authorization function

One function is used by **every** access path — REST API, MCP tools/resources, and the
share-link redemption endpoint. Pseudocode:

```
canView(user, artifact):
    if user.id == artifact.owner_id:          # owner always retains access
        return ALLOW
    if artifact.expires_at != NULL and now() >= artifact.expires_at:
        return DENY (expired)
    switch artifact.audience_type:
        case public_authenticated:            # user is authenticated by definition
            return ALLOW
        case specific_users:
            return ALLOW if user.id in artifact.allowed_user_ids else DENY
        case user_groups:
            return ALLOW if (user.group_ids ∩ artifact.allowed_group_ids) != ∅ else DENY

canComment(user, artifact):
    return canView(user, artifact)            # + caller is authenticated (always true)

canDownload(user, artifact):
    return canView(user, artifact)

canManagePolicy(user, artifact):
    return ALLOW if user.id == artifact.owner_id else DENY
```

Key properties:
- **Owner-first**: the owner short-circuits every check, including after expiry — this backs
  the "My Artifacts" requirement.
- **Authentication is a precondition** everywhere (no anonymous branch exists).
- **Comment = view**: anyone who can view can read comments; writing a comment additionally
  requires being authenticated (always true here) and is attributed to the caller.

This function lives in `core` and is unit-tested exhaustively (see `09`).

---

## 3. Truth table

| Caller vs artifact | Owner? | Expired? | Audience match? | View | Comment | Manage policy |
|--------------------|:------:|:--------:|:---------------:|:----:|:-------:|:-------------:|
| Owner | yes | no | — | ✅ | ✅ | ✅ |
| Owner | yes | **yes** | — | ✅ | ✅ | ✅ |
| Other, in audience | no | no | yes | ✅ | ✅ | ❌ |
| Other, in audience | no | **yes** | yes | ❌ | ❌ | ❌ |
| Other, not in audience | no | no | no | ❌ | ❌ | ❌ |
| Any non-owner | no | any | any | — | — | ❌ |

"Audience match" = `public_authenticated`, or `user ∈ specific_users`, or
`user.groups ∩ artifact.groups ≠ ∅`.

---

## 4. Revocation semantics

Revocation is not a separate mechanism — it is a consequence of **re-evaluating authorization
on every request**:

- The owner **edits the policy** (narrows audience, removes a user/group, or sets an earlier
  expiry). This updates the artifact's policy rows.
- The **next** request through any path re-runs `canView` against the *current* policy.
- Therefore **every previously issued share link stops granting access immediately** — the link
  is just a locator; it carries no standalone access. There is no cache of "who can see this"
  to invalidate.

Setting `expires_at` in the past (or reaching it) has the same effect for non-owners; the owner
still sees it in "My Artifacts."

---

## 5. Share links are pure locators

- A share link is `https://<app>/s/<token>` where `token` resolves (via `share_links`) to an
  artifact id. Store only `token_hash`.
- Redeeming a link:
  1. Resolve `token → artifact_id` (reject unknown/removed tokens).
  2. Require the caller to be **authenticated** (redirect to login if not).
  3. Run `canView(user, artifact)` against the **current** policy.
  4. If allowed and the caller wants the bytes, mint a **short-lived (~60s) presigned URL**
     (Tigris, S3-compatible) and redirect/stream; otherwise `403`.
- The link never encodes permission and never bypasses the policy. Tokens exist so URLs are
  clean and non-enumerable (not sequential ids), and so a link can be individually retired.
- **Minting** a link requires `canView(user, artifact)` (owner or any authorized viewer) — not
  ownership. Because the link carries no permission of its own, a non-owner viewer minting one
  can never grant a redeemer more access than that redeemer's own `canView` check already allows.

---

## 6. File delivery paths (two, kept separate)

| Path | Who | Mechanism | Notes |
|------|-----|-----------|-------|
| Browser download | Humans | `canView` → **~60s presigned URL** (Tigris, S3-compatible) | Bucket stays private; presigned URL is the only read path. Pin `ResponseContentType` / `ResponseContentDisposition` per redemption so PDFs open inline, images render, HTML serves correctly. |
| Agent fetch | MCP clients | **MCP Resource** `artifact://<id>` → server-side GetObject via the held scoped key (AWS SDK against Tigris) → bytes returned as blob+mime | Presigned URLs are **never** used here. Tool results stay metadata-only. See `05`. |

This separation means the presigned URL's short expiry never collides with agent timing, and
raw bytes never enter an agent's context window.

---

## 7. HTML-artifact sandboxing

Hosting arbitrary AI-generated HTML is an app-specific risk. Rule:

- HTML artifacts are **always** served from a **dedicated sandbox origin** (the object store's
  own domain or a dedicated sandbox subdomain), **never** inlined into the app origin.
- Serve with a restrictive **`Content-Security-Policy`** and `X-Content-Type-Options: nosniff`.
- This isolates any script in the artifact from the app's cookies/session/DOM.

Detailed headers live in `06` (§ HTML sandboxing).

---

## 8. Sequence diagrams

### Publish with policy
```
Owner ─publish(file, {audience, expiry})─▶ Backend
  Backend: create artifact row + policy (audience_type, allowed users/groups, expires_at)
           store file in Tigris (private bucket) via presigned PUT / server-side put
  Backend ─201 {artifactId}─▶ Owner
```

### View / download (non-owner)
```
User ─GET /s/<token>─▶ Backend
  resolve token→artifact ; require auth ; canView(user, artifact)?
     ├─ DENY ─▶ 403
     └─ ALLOW ─▶ mint ~60s presigned URL ─▶ 302 redirect ─▶ the object store streams bytes
```

### Revoke, then owner views
```
Owner ─PUT /artifacts/:id/policy {narrow audience}─▶ Backend (canManagePolicy? owner→ok)
Other ─GET /s/<token>─▶ canView → now DENY → 403        (old link dead instantly)
Owner ─GET /artifacts/:id (My Artifacts)─▶ canView → owner short-circuit → ALLOW
```

---

## 9. Comments (attributable reviews)

- **Read**: any user with `canView` may read all comments on the artifact.
- **Write**: requires `canView` + authentication (always true). The comment is attributed to the
  caller.
- Each comment stores **body, author, created_at**; the UI/MCP surface renders **body, author
  name, and date** (per the requirements).
- Comment authors control only their own comments (owner does not moderate in v1; deletion of
  comments is out of scope alongside artifact deletion).
