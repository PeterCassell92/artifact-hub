# Model — Collaboration (Comment, ShareLink, ArtifactRelationship)

Entities around reviewing, sharing, and linking artifacts.

---

## Comment (attributable review)

| Field | Type | Req | Meaning | Shown in UI |
|-------|------|:---:|---------|:-----------:|
| `id` | uuid | yes | Comment id | — |
| `artifactId` | uuid → Artifact | yes | Target artifact | — |
| `authorId` | uuid → User | yes | Attributed author | name shown |
| `body` | text | yes | Comment text | yes |
| `createdAt` | timestamp | yes | When left | date shown |

- **Read**: any user with `canView` on the artifact.
- **Write**: `canView` + authenticated (always true — no anonymous).
- UI/MCP render **body, author name, date** (per requirements). No edit/delete in v1.

## ShareLink (pure locator)

| Field | Type | Req | Meaning |
|-------|------|:---:|---------|
| `id` | uuid | yes | Link id |
| `artifactId` | uuid → Artifact | yes | What it points to |
| `tokenHash` | string (unique) | yes | SHA-256 of `/s/<token>`; raw token only in the URL |
| `createdById` | uuid → User | yes | Owner who minted it |
| `revoked` | bool | yes | Optional single-link retire; the **artifact policy remains authoritative** |
| `createdAt` | timestamp | yes | — |

A share link carries **no access policy**. Redemption re-runs `canView` against the artifact's
current policy (arch/03 §5), and each redemption writes an `AccessEvent` with `route=share_link`
and this `shareLinkId` (see `access-event.md`).

## ArtifactRelationship

| Field | Type | Req | Meaning |
|-------|------|:---:|---------|
| `id` | uuid | yes | Relationship id |
| `fromId` | uuid → Artifact | yes | Source artifact |
| `toId` | uuid → Artifact | yes | Target artifact |
| `type` | enum | yes | `supersedes` \| `derived_from` \| `related_to` |
| `note` | text | no | Short free-text label (≤280 chars), e.g. "post-processed export" |
| `createdById` | uuid → User | yes | Who linked them |
| `createdAt` | timestamp | yes | — |

Unique on `(fromId, toId, type)`. Written via the MCP `publish_artifact` tool's optional
`relationships` argument (at publish time), the SPA's publish modal (same field, in its Metadata
step), or the `link_artifacts` tool / `POST /api/artifacts/:id/relationships` (post-hoc, either
surface) — owner-only for `fromId`; `toId` only needs to be `canView`-able by the linker, not
owned by them. Read via `list_artifact_relationships` (MCP) or `GET
/api/artifacts/:id/relationships` — each row's `otherArtifact` is independently redacted to `null`
if the caller can't view that side, so a relationship visible on one artifact never leaks the
title/owner of a private artifact on its far end. Removed via `unlink_artifacts` (MCP) or `DELETE
/api/artifacts/:id/relationships/:relationshipId` — again owner-of-`fromId`-only; there's no
in-place edit, so changing a relationship is unlink then re-link. The SPA's artifact detail page
renders relationships with add/remove controls for the owner (outgoing side only — the `to` side's
owner has no say, matching creation); enables agent navigation and inference between related
artifacts (e.g. "this is an updated version of …").

**Bulk, corpus-wide read** via `list_relationships` (MCP) or `GET /api/relationships` — unlike
the two per-artifact reads above, this has no anchor artifact, so a row is returned whenever the
caller can view `from` **or** `to` (a row with neither side viewable is excluded outright, not
returned redacted); within a returned row each side is independently nulled out if that
particular artifact isn't viewable, same redaction rule as `otherArtifact` above, applied to both
ends. Optional `type` filter (`supersedes`/`derived_from`/`related_to`); omit it for every type in
one cursor-paginated call. Exists so an agent can reason over the relationship graph as a whole
(e.g. "which artifacts have been superseded") in one call instead of one per artifact.
