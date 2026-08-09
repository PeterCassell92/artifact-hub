# 02 — Filtering, Search & Sort

*Status: design. Related: [`01-frontend-overview.md`](01-frontend-overview.md),
[`../models/artifact.md`](../models/artifact.md),
[`../architecture/06-api-design.md`](../architecture/06-api-design.md).*

Discovery UX for **My Artifacts** and **Shared With Me**. The available filters are a direct
function of the artifact **metadata** we capture (see `../models/artifact.md` — the "Filterable?"
column is the contract this UI is built against).

---

## 1. Search

- A single **search box** matching across `title`, `description`, `fileName`, and `tags`.
- Debounced; server-side (cursor-paginated) so it scales with the corpus.
- Backed by an API query param (e.g. `?q=`) on the artifact list endpoints (`06`).

## 2. Filters (facets)

| Filter | Field(s) | Control |
|--------|----------|---------|
| **File type** | `contentType` / `fileExtension` | multi-select (PDF, image, HTML, mmd, md, docx, …) |
| **Kind** | `kind` (diagram/document/image/report/data/other) | multi-select |
| **Published date** | `publishedAt` | date range / presets (24h, 7d, 30d, custom) |
| **Publisher** | `ownerId` → User (Shared With Me) | people picker |
| **Tags** | `tags` | multi-select / typeahead |
| **Source tool** | `sourceTool` (e.g. Claude Desktop) | multi-select |
| **Audience** | `audienceType` (My Artifacts) | select (public / specific users / groups) |
| **Access state** | derived `isExpired` | toggle (active / expired) |
| **Shared window** | recency (Shared With Me) | quick "last 24 hours" (mirrors MCP `list_shared_with_me`) |

Filters are combinable; the active set is reflected in the URL (shareable/bookmarkable) and sent
as query params to the list API.

## 3. Sort

- **Published date** (newest/oldest) — default newest.
- **Title** (A–Z).
- **Last accessed** (derived from `AccessEvent`) — "recently active".
- **Size**.

## 4. How this maps to the backend

- The artifact list endpoints (`GET /api/artifacts`, `GET /api/artifacts?sharedWithMe=1`, `06`)
  accept the search term, facet filters, sort key, and a cursor.
- **Faceted fields are indexed** (filetype, publishedAt, ownerId, tags, kind); free-form
  `metadata`/`formatMeta` are only filtered on **known keys**, not scanned arbitrarily.
- Results always pass per-item `canView`, so filters never leak artifacts the user can't see.

## 5. Why the metadata breadth matters

The richer the captured metadata (`../models/artifact.md` §2), the more useful these filters
become. Publishing happens via MCP, so `publish_artifact` should encourage/collect this
classification metadata at publish time (kind, tags, sourceTool, format) — the frontend's
discovery quality depends on it.
