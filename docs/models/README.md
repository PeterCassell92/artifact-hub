# Domain Models

Conceptual, field-level definitions of the data Artifact Hub stores — the **source of truth for
modelling**, written before any database code. These docs are deliberately implementation-agnostic
(no Prisma/SQL yet); the first Prisma schema will be **generated from these models** at a later
step. Until then, [`../architecture/04-data-model.md`](../architecture/04-data-model.md) holds an
illustrative Prisma sketch and the ERD, which will be reconciled against this folder.

## Why this folder exists

We want to capture a **wide range of metadata** per artifact (it drives what the frontend can
filter and search on — see [`../frontend/`](../frontend/)) and to maintain a proper **access
audit trail** (who accessed what, when, and by which route). Those two needs justify modelling
carefully before writing schema.

## Contents

| Doc | Model(s) | Why it matters |
|-----|----------|----------------|
| [`artifact.md`](artifact.md) | Artifact + its metadata catalogue | The rich metadata set; drives UI filters/search |
| [`access-event.md`](access-event.md) | AccessEvent (access audit trail) | Audits every view/download via UI, share link, or MCP |
| [`identity.md`](identity.md) | User, Group, GroupMembership, Invitation | Onboarding + authz subjects |
| [`collaboration.md`](collaboration.md) | Comment, ShareLink, ArtifactRelationship | Reviews, locators, artifact-to-artifact links |
| [`system.md`](system.md) | OutboxEvent, AdminAuditLog | Reliability + admin-action audit (distinct from AccessEvent) |

## Conventions used in these docs

- Each field: **name — type — required? — meaning**, plus a **Filterable?** column where it
  affects the frontend.
- "Derived" fields are computed, not stored.
- Ids are opaque UUIDs unless noted. Timestamps are UTC.
- **Two audit trails, kept separate**: `AccessEvent` (artifact access) vs `AdminAuditLog`
  (administrative actions like invite/promote/policy-change). See `system.md`.
