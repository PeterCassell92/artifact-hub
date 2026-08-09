# 04 — Data Model (Prisma / PostgreSQL)

*Status: design. Related: [02](02-auth-identity-and-admin.md),
[03](03-authorization-and-access-control.md), [06](06-api-design.md).*

All metadata lives in RDS PostgreSQL (private subnet). Files live in S3 (`s3_key` references
only). The schema is expressed with **Prisma**; migrations are managed by Prisma Migrate.

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
  s3Key         String       @unique
  sizeBytes     BigInt
  metadata      Json         @default("{}")    // free-form (JSONB)

  // ── access policy (one per artifact) ──
  audienceType  AudienceType @default(specific_users)
  expiresAt     DateTime?                       // null = never
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

  @@index([ownerId, createdAt])
  @@index([audienceType])
  @@index([expiresAt])
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

model AuditLog {                               // see 10 §audit
  id         String   @id @default(uuid())
  actorId    String?
  action     String                            // e.g. "invite.create", "policy.update"
  targetType String
  targetId   String
  metadata   Json     @default("{}")
  createdAt  DateTime @default(now())
  @@index([targetType, targetId])
}
```

---

## 3. Notes on modelling choices

- **Policy on the artifact, not the link.** `audienceType` + `expiresAt` on `Artifact` = one
  policy per artifact; `ArtifactAllowedUser` / `ArtifactAllowedGroup` back the `specific_users`
  / `user_groups` audiences. This is what `03`'s `canView` reads.
- **`expiresAt` nullable = "never".** The 24h/7d/30d/never buckets map to an absolute timestamp
  (or null) computed at publish/policy-update time.
- **Share links carry no policy.** `revoked` is an optional convenience to retire a single link;
  the artifact policy remains authoritative.
- **`metadata` JSONB** is free-form per-artifact metadata; structured, queryable labels use
  `Tag`/`ArtifactTag`.
- **Relationships** are additive and unused by v1 UI beyond storage + a read endpoint.
- **Immutable group membership** is enforced in the service layer (no self-service mutation
  route) rather than a DB trigger; admin corrective edits are audit-logged.

---

## 4. Indexes that matter

- `ArtifactAllowedUser(userId)` and `ArtifactAllowedGroup(groupId)` → fast "shared with me /
  my groups" queries (drives the MCP `list_shared_with_me` and the SPA gallery).
- `Artifact(ownerId, createdAt)` → "My Artifacts."
- `Artifact(expiresAt)` → optional sweep/reporting of expired artifacts.
- `Comment(artifactId, createdAt)` → ordered comment lists.

---

## 5. S3 key layout

```
s3://<artifacts-bucket>/artifacts/<artifactId>/<original-filename>
```

- Bucket has **Block Public Access** on; the only read path is a presigned URL (browser) or a
  server-side IAM-role read (MCP resource). See `07` for lifecycle/storage-class escalation.
- `s3Key` is stored on the artifact; content is immutable (no edit/delete in v1).

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
