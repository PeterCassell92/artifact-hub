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

## ArtifactRelationship (forward-looking)

| Field | Type | Req | Meaning |
|-------|------|:---:|---------|
| `id` | uuid | yes | Relationship id |
| `fromId` | uuid → Artifact | yes | Source artifact |
| `toId` | uuid → Artifact | yes | Target artifact |
| `type` | enum | yes | `supersedes` \| `derived_from` \| `related_to` |
| `createdById` | uuid → User | yes | Who linked them |
| `createdAt` | timestamp | yes | — |

Unique on `(fromId, toId, type)`. Additive in v1 (storage + read API); enables future UI/agent
navigation between related artifacts (e.g. "this is an updated version of …").
