# Artifact Hub — Systems Architecture Quick Reference

> ⚠️ **SUPERSEDED (2026-08-09).** This early scoping note is kept for history only. The current
> architecture lives in [`architecture/`](architecture/), starting at
> [`architecture/01-overview.md`](architecture/01-overview.md). Where this file and the
> `architecture/` set disagree, **`architecture/` wins** — notably: no anonymous access at all;
> one owner-controlled access policy per artifact (share links are pure locators); app-managed,
> admin-assigned immutable groups; an admin area with SES email invitations; Express (not
> Fastify); Prisma; S3+CloudFront frontend; a monorepo.

*Last updated: 2026-08-09 (rev 2)*

A living reference of the architecture decisions made so far for the AI Artifact
Hub. Sections marked **DECIDED** are settled; **OPEN** needs a choice; **DEFERRED**
is intentionally postponed prod-hardening.

---

## 1. What we're building

A hub for publishing and sharing AI-generated content (artifacts). Core features:

- **Publish** artifacts (HTML, images, PDFs at minimum) with metadata (title,
  description, tags/categories).
- **Browse** a gallery/catalog of published artifacts.
- **Share** with configurable access — time-limited links, and direct shares to
  registered users.
- **Feedback** — structured comments on artifacts.
- **MCP server** — so Claude Desktop / other MCP clients can publish and manage
  artifacts conversationally.

---

## 2. High-level shape

```
                       ┌──────────────────────────┐
   Browser (SPA) ─────▶│  Frontend (Netlify/Vercel)│
                       └────────────┬─────────────┘
                                    │ HTTPS (CORS)
                                    ▼
   Claude Desktop ────▶ ┌───────────────────────────────────┐
   / MCP clients        │  Node + TypeScript backend         │
   (Streamable HTTP)    │  (single deployable, modular)      │
                        │                                    │
                        │   adapters/http  →  /api/*         │
                        │   adapters/mcp   →  /mcp           │
                        │            \       /               │
                        │             core (domain logic)    │
                        └───────┬───────────────┬────────────┘
                                │               │
                        IAM role│               │ VPC (private)
                                ▼               ▼
                        ┌──────────────┐  ┌──────────────┐
                        │   S3 bucket  │  │  RDS Postgres │
                        │ (artifact    │  │  (metadata,   │
                        │  files)      │  │  users, etc.) │
                        └──────────────┘  └──────────────┘
                                ▲
                        Auth0 (OIDC) — authenticates humans AND
                        backs the MCP OAuth flow (one IdP, two roles)
```

---

## 3. Core architecture decisions

### Backend: modular monolith — **DECIDED**
One Node.js/TypeScript service serves **both** the REST API (for the frontend)
and the MCP server (for Claude clients). Not split into separate services.

- **Why:** REST and MCP invoke the *same* business operations (publish, list,
  comment, share). One shared `core` layer avoids duplicated logic or an internal
  network hop. Simpler deploy, one codebase, cheaper for a demo.
- **Enabled by:** modern remote MCP uses **Streamable HTTP**, which is just HTTP
  routes — no long-lived socket per client — so it colocates cleanly with the API.
- **Keep the seam clean:** structure as `core/` (domain logic) + thin
  `adapters/http` and `adapters/mcp`. The MCP adapter calls `core.*`, never the
  HTTP layer. This keeps a future split to a lift-and-shift, not a rewrite.

```
backend/
├── core/            domain logic: artifacts, sharing, comments, storage, authz
├── adapters/http    Fastify routes:  /api/*   (frontend)
└── adapters/mcp     Streamable HTTP: /mcp      (Claude clients)
```

### MCP transport: Streamable HTTP — **DECIDED**
Single `/mcp` endpoint over Streamable HTTP. **Not SSE** (deprecated for new
servers). Stateless-friendly, scales behind a normal load balancer.

### Database: AWS RDS (PostgreSQL) — **DECIDED**
Holds all metadata: users, artifacts, tags, comments, share links, grants.
Runs in a **private subnet** (see §7).

### Object storage: AWS S3 — **DECIDED**
Holds the artifact file bodies (HTML, images, PDFs). Bucket is fully private
(Block Public Access on). All reads/writes via presigned URLs (see §5).

### Backend host — **OPEN** (recommended: AWS ECS Fargate + ALB)
Now that we're AWS-native (RDS + S3), Fargate behind an ALB is the natural fit:
TLS termination, health checks, autoscaling, and a long-running container suits
OAuth flows + streaming better than Lambda. Fly.io / Render are simpler
alternatives if we want to move faster. **Avoid Lambda** for the MCP endpoint.

### Frontend host — **OPEN** (recommended: Netlify or Vercel)
SPA with a signup/login page. Separate origin from the backend → configure CORS.
S3 + CloudFront is the AWS-native alternative if we want everything in one cloud.

---

## 4. Identity & auth — **DECIDED: Auth0**

There are **two OAuth roles**, and one IdP (Auth0) serves both:

- **Role A — humans logging into the app.** Standard OIDC. Frontend signup/login;
  API trusts the token.
- **Role B — Claude Desktop connecting to `/mcp`.** Our MCP server is an OAuth
  *Resource Server*; Claude is the *client*; Auth0 is the *Authorization Server*.
  Requires Protected Resource Metadata + **Dynamic Client Registration** so Claude
  can register itself.

Same identity, two front doors: `/api/*` and `/mcp` validate tokens identically.

**Cost:** Auth0 free tier covers up to 25,000 MAU — free at demo scale. Upgrade
trigger is feature-gating (e.g. custom login domain), not user count.

**⚠️ To verify:** confirm **Dynamic Client Registration is available on the free
tier** — the MCP connection depends on it. (Auth0 reached GA MCP support ~May 2026.)

**Sequencing:** build Role A first (app login + protected API), then layer the
MCP resource-server metadata onto the same Auth0 tenant.

---

## 5. Sharing model — **DECIDED**

Two distinct mechanisms:

### a) Time-limited share links (`share_links`)
- Mint a clean token → `hub.app/s/<token>`, stored in RDS with an `expires_at`
  (any length), optional `max_views`, `revoked` flag, and per-link `visibility`.
- **The share link is NOT a presigned URL.** On redemption, the server validates
  the token row (not revoked / not expired / views remaining), then generates a
  **short-lived (~60s) presigned S3 URL** and redirects to it.
- **Why two layers:** decouples the link's lifetime + revocability (our policy, in
  RDS) from the S3 signature's 7-day max & un-revocability (kept to seconds).

### b) Direct share to a registered user (`artifact_grants`)
- Look up the target user by email → insert a grant row → artifact appears in
  their gallery under "shared with me." An ACL entry, no token/expiry needed.

### Presigned URL notes
- Bucket stays fully private; presigned URLs are the only read path.
- Pin `ResponseContentType` / `ResponseContentDisposition` per redemption so PDFs
  open inline, images render, HTML serves correctly, etc.
- Uploads: hand MCP publish clients a **presigned PUT** so bytes go straight to S3.
- Outgrow path (later): CloudFront signed URLs/cookies for CDN + custom domain.

### Visibility rules
- Per-link `visibility`: `public` (view without signup) / `authenticated` (must be
  signed in) / `restricted` (specific granted users).
- **Firm rule:** viewing may be anonymous per-link; **leaving a comment always
  requires auth** (so feedback is attributable).

---

## 6. MCP interaction & file delivery — **DECIDED**

**Principle: the agent never handles a link or presigned URL.** Authorization comes
from the agent's OAuth token; content comes back through MCP itself.

- **Tools** (agent reasons over content): e.g. `get_artifact(id)` returns
  small/medium content inline — image → image block (native vision); small
  text/PDF → embedded resource. Authz via OAuth token → ownership/grant check.
- **Resources** (files & large content): expose each artifact as a **stable
  resource URI `artifact://<id>` with blob + mimeType**. Client reads it on demand;
  server authorizes via token, pulls from S3 **server-side (IAM role)**, returns
  bytes. Tool results stay **metadata-only (~4KB)**, never raw bytes.
- **Download to disk = host-mediated.** Human clicks *save* in Claude Desktop; the
  host writes the file. No silent agent-to-disk. (Confirmed acceptable.)
- **Presigned URLs stay OUT of the MCP path** — they're only for the browser/share
  flow. Their short (~60s) expiry therefore never collides with agent timing; the
  resource URI re-authorizes and re-fetches fresh on each read.
- **Size** is handled by resources (not tool-result context), so large files are a
  transfer concern, not a context-window problem.
- **⚠️ Test on Claude Desktop directly:** cross-client divergence + reported
  base64 / embedded-resource quirks. Verify magic bytes (e.g. `%PDF`) and correct
  mimeType.

**Proposed MCP surface (v1):**
- Tools: `publish_artifact`, `list_artifacts`, `get_artifact`,
  `comment_on_artifact`, `create_share_link`, `share_with_user`
- Resources: `artifact://<id>` (blob + mime); optionally a browsable artifact
  collection resource

---

## 7. Data model (sketch)

```
users            (id, idp_sub, email, name, avatar_url, created_at)
artifacts        (id, owner_id→users, title, description, content_type,
                  s3_key, visibility, created_at)
tags             (id, name)
artifact_tags    (artifact_id, tag_id)
comments         (id, artifact_id, author_id→users, body, created_at)
share_links      (id, token, artifact_id, created_by→users, expires_at,
                  max_views, view_count, revoked, visibility)
artifact_grants  (artifact_id, grantee_id→users, permission, granted_by→users,
                  created_at)
```

Every actor is a `users` row, keyed to the Auth0 subject (`idp_sub`).

---

## 8. Open architecture questions (decide before/while building)

- **Authorization model (authz ≠ authn).** Proposed default: owner-based — creator
  owns the artifact and controls sharing/deletion; others get rights via grant or
  share link; comment authors control only their own comments.
- **HTML artifact sandboxing.** App-specific risk (hosting arbitrary AI-generated
  HTML). Decision: always render HTML artifacts from the **storage origin / a
  dedicated sandbox subdomain**, never inlined into the app origin, + restrictive
  `Content-Security-Policy`.
- **Network topology.** RDS in a **private subnet** (never public); backend reaches
  it inside the VPC; S3 access via **IAM role**, not long-lived keys.
- **Secrets & path-to-prod.** Secrets in AWS Secrets Manager / Parameter Store
  (Auth0 client secret, DB creds). Deploys via CI, not by hand.
- **Backend & frontend hosts** — finalize the recommendations in §3.

---

## 9. Deferred (prod-hardening — note now, add later)

- Observability: structured logs, metrics, error tracking (e.g. Sentry), health
  checks.
- Rate limiting / abuse protection on the public share and `/mcp` endpoints.
- Backups: RDS automated backups, S3 versioning.
- CDN (CloudFront) in front of S3.
- Upload validation: size caps, MIME validation, content moderation/scanning.

---

## 10. Decision log (one-liners)

| Area              | Decision                                          | Status   |
|-------------------|---------------------------------------------------|----------|
| Backend shape     | Modular monolith (API + MCP combined)             | DECIDED  |
| MCP transport     | Streamable HTTP, single `/mcp` (not SSE)          | DECIDED  |
| Database          | AWS RDS (PostgreSQL), private subnet              | DECIDED  |
| Object storage    | AWS S3, private bucket                             | DECIDED  |
| Sharing           | Token layer (RDS) + short-lived presigned S3 URLs | DECIDED  |
| Direct share      | `artifact_grants` ACL to registered users         | DECIDED  |
| Identity provider | Auth0 (OIDC; backs app login + MCP OAuth)         | DECIDED  |
| Comments          | Always require auth (attributable)                 | DECIDED  |
| MCP file delivery | Resources (blob+mime) for files; tools for small   | DECIDED  |
| MCP authz         | OAuth token, not links; presigned stays browser    | DECIDED  |
| Download to disk  | Host-mediated (human clicks save)                  | DECIDED  |
| Backend host      | ECS Fargate + ALB (recommended)                   | OPEN     |
| Frontend host     | Netlify / Vercel (recommended)                    | OPEN     |
| Authz model       | Owner-based (proposed)                             | OPEN     |
| HTML sandboxing   | Serve off storage origin + CSP (proposed)         | OPEN     |
```