# 04 — Data Model (Prisma / PostgreSQL)

*Status: design. Related: [02](02-auth-identity-and-admin.md),
[03](03-authorization-and-access-control.md), [06](06-api-design.md).*

All metadata lives in **Fly Managed Postgres** (private network). Files live in a private
**object store (Tigris, S3-compatible)** — the DB holds `storageKey` references only. The schema is
expressed with **Prisma**; migrations are managed by Prisma Migrate.

> **Source of truth for modelling is now [`../models/`](../models/).** That folder holds the
> field-level, implementation-agnostic model definitions (the full artifact **metadata
> catalogue** and the **AccessEvent** audit trail). The Prisma sketch below is illustrative and
> will be **reconciled/generated from `../models/`** when we build the first real schema. Where
> they differ, `../models/` wins.

---

## 1. Entity-relationship overview

```
users ──< group_memberships >── groups
  │ owns                              ▲ allowed via
  ▼                                   │
artifacts ──1:1── (policy fields)     │
  │  ├──< artifact_allowed_users >── users
  │  ├──< artifact_allowed_groups >── groups
  │  ├──< artifact_tags >── tags
  │  ├──< comments (author→users)
  │  ├──< share_links (created_by→users)
  │  └──< artifact_relationships >── artifacts   (self, from/to)
invitations (invited_by→users)
outbox   (reliability, §7)
audit_log (§8)
```

The policy is modeled as **fields on `artifacts`** (one policy per artifact) plus two join
tables for the `specific_users` / `user_groups` audiences.

---

## 2. Prisma schema (proposed)

```prisma
// datasource + generator omitted for brevity (Postgres + prisma-client-js)

enum Role            { member admin }
enum UserStatus      { invited active disabled }
enum AudienceType    { public_authenticated specific_users user_groups }
enum InviteStatus    { pending accepted expired revoked }
enum RelationType    { supersedes derived_from related_to }
enum ArtifactKind    { diagram document image report data other }
enum AccessRoute     { ui share_link mcp }
enum AccessAction    { view download }
enum AccessDecision  { allowed denied }

model User {
  id            String   @id @default(uuid())
  idpSub        String?  @unique            // Auth0 subject; null until first login
  email         String   @unique
  name          String?
  avatarUrl     String?
  role          Role     @default(member)
  status        UserStatus @default(invited)
  createdAt     DateTime @default(now())

  memberships   GroupMembership[]
  artifacts     Artifact[]        @relation("owner")
  comments      Comment[]
  allowedFor    ArtifactAllowedUser[]
  shareLinks    ShareLink[]
  invitesSent   Invitation[]      @relation("invitedBy")
}

model Group {
  id          String   @id @default(uuid())
  name        String   @unique
  description String?
  createdAt   DateTime @default(now())

  memberships GroupMembership[]
  allowedFor  ArtifactAllowedGroup[]
}

model GroupMembership {          // admin-assigned, immutable by the user (see 02 §3)
  userId   String
  groupId  String
  addedAt  DateTime @default(now())
  user     User  @relation(fields: [userId], references: [id])
  group    Group @relation(fields: [groupId], references: [id])
  @@id([userId, groupId])
}

model Invitation {
  id         String       @id @default(uuid())
  email      String
  role       Role         @default(member)
  groupIds   String[]                        // groups to assign on accept
  tokenHash  String       @unique            // sha-256 of the emailed token
  status     InviteStatus @default(pending)
  invitedById String
  invitedBy  User         @relation("invitedBy", fields: [invitedById], references: [id])
  expiresAt  DateTime
  acceptedAt DateTime?
  createdAt  DateTime     @default(now())
  @@index([email])
}

model Artifact {
  id            String       @id @default(uuid())
  ownerId       String
  owner         User         @relation("owner", fields: [ownerId], references: [id])
  title         String
  description   String?
  fileName      String
  contentType   String                        // MIME
  storageKey    String       @unique           // object key in the Tigris (S3-compatible) bucket
  sizeBytes     BigInt
  checksumSha256 String?
  // ── classification metadata (drives frontend filters; see ../models/artifact.md) ──
  kind          ArtifactKind @default(other)
  sourceTool    String?                         // e.g. "Claude Desktop"
  sourcePlatform String?
  format        String?                          // e.g. "mermaid", "markdown", "png"
  formatMeta    Json         @default("{}")      // format-specific (page count, dims, diagram type)
  language      String?
  metadata      Json         @default("{}")      // free-form catch-all (JSONB)

  // ── access policy (one per artifact) ──
  audienceType  AudienceType @default(specific_users)
  expiresAt     DateTime?                       // null = never; relative to publishedAt, not edit time
  revoked       Boolean      @default(false)     // explicit instant cutoff, independent of expiresAt (03 §1a)
  policyUpdatedAt DateTime   @default(now())
  policyUpdatedById String?

  createdAt     DateTime     @default(now())

  allowedUsers  ArtifactAllowedUser[]
  allowedGroups ArtifactAllowedGroup[]
  tags          ArtifactTag[]
  comments      Comment[]
  shareLinks    ShareLink[]
  relFrom       ArtifactRelationship[] @relation("from")
  relTo         ArtifactRelationship[] @relation("to")
  accessEvents  AccessEvent[]

  @@index([ownerId, createdAt])
  @@index([audienceType])
  @@index([expiresAt])
  @@index([kind])
  @@index([sourceTool])
}

model ArtifactAllowedUser {
  artifactId String
  userId     String
  artifact   Artifact @relation(fields: [artifactId], references: [id])
  user       User     @relation(fields: [userId], references: [id])
  @@id([artifactId, userId])
  @@index([userId])                            // "shared directly with me"
}

model ArtifactAllowedGroup {
  artifactId String
  groupId    String
  artifact   Artifact @relation(fields: [artifactId], references: [id])
  group      Group    @relation(fields: [groupId], references: [id])
  @@id([artifactId, groupId])
  @@index([groupId])                           // "shared with my group"
}

model Tag {
  id    String @id @default(uuid())
  name  String @unique
  artifacts ArtifactTag[]
}

model ArtifactTag {
  artifactId String
  tagId      String
  artifact   Artifact @relation(fields: [artifactId], references: [id])
  tag        Tag      @relation(fields: [tagId], references: [id])
  @@id([artifactId, tagId])
}

model Comment {
  id         String   @id @default(uuid())
  artifactId String
  authorId   String
  body       String
  createdAt  DateTime @default(now())
  artifact   Artifact @relation(fields: [artifactId], references: [id])
  author     User     @relation(fields: [authorId], references: [id])
  @@index([artifactId, createdAt])
}

model ShareLink {
  id          String   @id @default(uuid())
  artifactId  String
  tokenHash   String   @unique               // sha-256 of the /s/<token>
  createdById String
  revoked     Boolean  @default(false)       // optional per-link retire; policy still authoritative
  createdAt   DateTime @default(now())
  artifact    Artifact @relation(fields: [artifactId], references: [id])
  createdBy   User     @relation(fields: [createdById], references: [id])
}

model ArtifactRelationship {                  // forward-looking (see 01 #23)
  id          String       @id @default(uuid())
  fromId      String
  toId        String
  type        RelationType
  createdById String
  createdAt   DateTime     @default(now())
  from        Artifact     @relation("from", fields: [fromId], references: [id])
  to          Artifact     @relation("to",   fields: [toId],   references: [id])
  @@unique([fromId, toId, type])
}

model OutboxEvent {                            // transactional outbox (see 02 §6)
  id           String   @id @default(uuid())
  type         String                          // e.g. "invitation.send"
  payload      Json
  status       String   @default("pending")    // pending | done | failed
  attempts     Int      @default(0)
  idempotencyKey String @unique
  createdAt    DateTime @default(now())
  processedAt  DateTime?
}

model AdminAuditLog {                          // administrative actions (see 10 §audit, models/system.md)
  id         String   @id @default(uuid())
  actorId    String?
  action     String                            // "invite.create", "role.change", "policy.update", …
  targetType String
  targetId   String
  metadata   Json     @default("{}")           // e.g. { before, after } for role/group changes
  createdAt  DateTime @default(now())
  @@index([targetType, targetId])
}

model AccessEvent {                            // artifact ACCESS audit trail (see models/access-event.md)
  id          String         @id @default(uuid())
  artifactId  String
  userId      String                            // always set — no anonymous access
  route       AccessRoute                       // ui | share_link | mcp
  action      AccessAction                      // view | download
  shareLinkId String?                           // set when route = share_link
  decision    AccessDecision                    // allowed | denied (we record denials too)
  denyReason  String?                           // e.g. "expired", "not_in_audience"
  clientInfo  Json     @default("{}")           // non-PII: client name/version, coarse UA
  at          DateTime @default(now())
  artifact    Artifact @relation(fields: [artifactId], references: [id])

  @@index([artifactId, at])
  @@index([userId, at])
  @@index([route])
}
```

---

## 3. Notes on modelling choices

- **Policy on the artifact, not the link.** `audienceType` + `expiresAt` + `revoked` on `Artifact`
  = one policy per artifact; `ArtifactAllowedUser` / `ArtifactAllowedGroup` back the
  `specific_users` / `user_groups` audiences. This is what `03`'s `canView` reads.
- **`expiresAt` nullable = "never".** The 24h/7d/30d/never buckets map to an absolute timestamp
  (or null) computed relative to `publishedAt`/`createdAt` — a fixed deadline set at publish time,
  not "now" at whatever moment the policy is later edited (`03` §1).
- **`Artifact.revoked` vs `ShareLink.revoked` — two different, unrelated flags of the same name.**
  `Artifact.revoked` (`03` §1a) is the owner's instant, whole-artifact cutoff — it's what `canView`
  checks. `ShareLink.revoked` below is an optional convenience to retire one specific link; the
  artifact policy remains authoritative regardless of either.
- **Rich artifact metadata.** Beyond `metadata` JSONB (free-form), we store faceted columns
  (`kind`, `sourceTool`, `format`, `language`, …) plus `Tag`/`ArtifactTag`, because these drive
  the frontend filters/search. Full catalogue: [`../models/artifact.md`](../models/artifact.md).
- **Two audit trails, separate on purpose.** `AccessEvent` = artifact *access* (view/download via
  `ui` / `share_link` / `mcp`, allowed **and** denied); `AdminAuditLog` = administrative actions
  (invite, **role.change** promote/demote, group change, **policy.update** revocation). Rationale
  in [`../models/system.md`](../models/system.md) and [`../models/access-event.md`](../models/access-event.md).
- **Relationships** are additive and unused by v1 UI beyond storage + a read endpoint.
- **Immutable group membership** is enforced in the service layer (no self-service mutation
  route) rather than a DB trigger; admin corrective edits are audit-logged.
- **Passwordless**: `User` has no password field — auth is magic link (see `02`).

---

## 4. Indexes that matter

- `ArtifactAllowedUser(userId)` and `ArtifactAllowedGroup(groupId)` → fast "shared with me /
  my groups" queries (drives the MCP `list_shared_with_me` and the SPA gallery).
- `Artifact(ownerId, createdAt)` → "My Artifacts."
- `Artifact(expiresAt)` → optional sweep/reporting of expired artifacts.
- `Comment(artifactId, createdAt)` → ordered comment lists.
- `AccessEvent(artifactId, at)` / `AccessEvent(userId, at)` → per-artifact and per-user access
  history for the audit trail.

---

## 5. Object-store key layout

```
artifacts/<artifactId>/<original-filename>
```

- The **Tigris** bucket is **private by default**; the only read path is a presigned URL (browser)
  or a server-side read via the held scoped key (MCP resource). See `07` for storage/auto-tiering.
- `storageKey` is stored on the artifact; content is immutable (no edit/delete in v1).

---

## 6. Prisma migration workflow (see also the `prisma-migrate` skill)

- **Local dev**: edit `schema.prisma` → `yarn prisma migrate dev --name <change>` (creates +
  applies a migration, regenerates the client).
- **Rebuild dev data**: `yarn prisma migrate reset` then `yarn prisma db seed`.
- **CI/prod**: `yarn prisma migrate deploy` (applies pending migrations, no prompts) as a
  pipeline step (see `08`).
- **Seed** (`prisma/seed.ts`): seeds initial groups and the initial admins from
  `INITIAL_ADMIN_EMAILS` (idempotent — see `02` §5).
- **Guardrails**: never edit an applied migration; always add a new one. Test migrations against
  an ephemeral Postgres (Testcontainers) in CI.
