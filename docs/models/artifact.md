# Model — Artifact (+ metadata catalogue)

The central entity. We capture a **wide range of metadata** so the frontend can filter, search,
and group artifacts richly, and so agents can reason over them. Fields are grouped by concern.

Related: [`../frontend/02-filtering-and-search.md`](../frontend/02-filtering-and-search.md)
(what these power), [`../architecture/03-authorization-and-access-control.md`](../architecture/03-authorization-and-access-control.md)
(policy fields), [`access-event.md`](access-event.md) (access audit).

---

## 1. Core identity & storage

| Field | Type | Req | Meaning | Filterable? |
|-------|------|:---:|---------|:-----------:|
| `id` | uuid | yes | Artifact identifier | — |
| `ownerId` | uuid → User | yes | The publisher; rectify against User for name/email | yes (by publisher) |
| `title` | string | yes | Human title | search |
| `description` | text | no | Longer description | search |
| `fileName` | string | yes | Original filename | search |
| `contentType` | string (MIME) | yes | e.g. `application/pdf` | yes (filetype) |
| `fileExtension` | string | derived | e.g. `.pdf`, `.mmd` — derived from fileName/contentType | yes (filetype) |
| `storageKey` | string | yes | Object key in the private Tigris (S3-compatible) bucket | — |
| `sizeBytes` | bigint | yes | File size | yes (range) |
| `checksumSha256` | string | no | Content hash (integrity / dedupe signal) | — |
| `createdAt` / `publishedAt` | timestamp | yes | Publication date | yes (date range) |

## 2. Classification & discovery metadata

Baseline the requirements call out: **file type, published date, publishingUserId**. Beyond that,
we capture a broad, mostly-optional set to make discovery powerful:

| Field | Type | Req | Meaning | Filterable? |
|-------|------|:---:|---------|:-----------:|
| `kind` | enum | no | High-level category: `diagram` \| `document` \| `image` \| `report` \| `data` \| `other` | yes (facet) |
| `tags` | string[] (via Tag join) | no | Free labels | yes (facet) |
| `sourceTool` | string | no | Generating tool, e.g. `Claude Desktop` | yes (facet) |
| `sourcePlatform` | string | no | e.g. `mcp` / client info | yes |
| `format` | string | no | Format detail, e.g. `mermaid`, `markdown`, `png` | yes |
| `formatMeta` | json | no | Format-specific detail (e.g. mermaid diagram type, page count for PDF, image dimensions) | partial |
| `language` | string | no | Natural/programming language if applicable | yes |
| `metadata` | json (free-form) | no | Catch-all key/values not worth a column | partial (known keys) |

## 3. Access policy (one per artifact — see architecture/03)

| Field | Type | Req | Meaning | Filterable? |
|-------|------|:---:|---------|:-----------:|
| `audienceType` | enum | yes | `public_authenticated` \| `specific_users` \| `user_groups` | yes (mine: by audience) |
| `allowedUserIds` | uuid[] (join) | cond | For `specific_users` | — |
| `allowedGroupIds` | uuid[] (join) | cond | For `user_groups` | — |
| `expiresAt` | timestamp \| null | yes | Null = never; else absolute expiry, `publishedAt` + 24h/7d/30d bucket (not "now" at edit time — arch/03 §1) | yes (active/expired) |
| `revoked` | boolean | yes | Owner-initiated instant cutoff, independent of `expiresAt` (arch/03 §1a). Cleared back to `false` whenever a new policy is saved. | no |
| `policyUpdatedAt` | timestamp | yes | Last policy change (revocation audit) | — |
| `policyUpdatedById` | uuid → User | no | Who last changed the policy (owner) | — |

## 4. Derived / computed (not stored)

| Field | How | Used by |
|-------|-----|---------|
| `isExpired` | `expiresAt != null && now >= expiresAt` | UI badge, filters |
| `status` (SPA-only label, not an API field) | `revoked ? "Revoked" : isExpired ? "Expired" : "Accessible"` | Artifact detail page, owner's policy panel |
| `viewerCanView` | `canView(currentUser, artifact)` (arch/03) | UI gating |
| `commentCount` | count of Comments | UI list |
| `lastAccessedAt` | max(AccessEvent.at); **stored** (denormalized column, indexed) so `sort=lastAccessed` can cursor-paginate — see architecture/01 §5 decision #45 | "recently accessed" / `sort=lastAccessed` |
| `publisherName` | join ownerId → User.name | UI/MCP display |

## 5. Relationships (see collaboration.md)

Artifacts may relate to one another (`supersedes` / `derived_from` / `related_to`) via
`ArtifactRelationship`. Forward-looking for UI/agent navigation.

## 6. Notes

- **Metadata is captured at publish time via MCP** (the only publish path — see
  `../architecture/05-mcp-server-design.md`). `publish_artifact` should accept the classification
  fields above; the backend derives `fileExtension`, `sizeBytes`, `checksumSha256`.
- **Filterability** here is the contract the frontend filter/search UI is built against
  (`../frontend/02-filtering-and-search.md`). Known/faceted fields get indexes; free-form
  `metadata`/`formatMeta` are queried on known keys only.
- No edit/delete of artifacts in v1 (content is immutable once published).
