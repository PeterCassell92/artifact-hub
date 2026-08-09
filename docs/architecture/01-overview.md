# 01 — System Overview & Decision Log

*Status: design. Supersedes [`../initial_architecture_wip_file.md`](../initial_architecture_wip_file.md).*

This is the entry point for the Artifact Hub architecture. It states the problem, the
system shape, the settled decisions, and a requirements-traceability matrix. Deeper detail
lives in the sibling documents `02`–`10`.

---

## 1. Problem & purpose

People across the company generate artifacts with AI tools (PDFs, HTML, images, `.docx`,
`.mmd`, `.md`, …) but sharing is painful and access control is ad-hoc — links expire
unpredictably and access cannot be reliably revoked.

**Artifact Hub** is a hosted (no-install) platform to **publish, share, and review**
AI-generated artifacts, with **managed, revocable access control** set at publish time.
It is usable two ways over the same core logic:

- **Humans** via a web SPA (browse, view, download, comment, administer users).
- **AI agents** (Claude Desktop and other MCP clients) via a hosted **MCP server** —
  publish, list, fetch, comment, and share conversationally.

---

## 2. Core principles (read these first)

1. **No anonymous access, ever.** Every viewer is an authenticated user. There is no
   "public link that works without login." "Public" means *any authenticated user*.
2. **Access policy lives on the artifact and is owner-controlled.** One policy per
   artifact (audience + expiry). Only the owner can change it.
3. **Authorization is re-evaluated server-side on every request.** This is what makes
   revocation instantaneous — editing the policy immediately invalidates every previously
   issued link. Share links are *pure locators*, never bearer tokens of access.
4. **The owner never loses access to their own artifact** (the "My Artifacts" view), even
   after the policy expires.
5. **The backend contains no LLM calls.** All logic is deterministic. The only model in the
   loop is the *client's* (e.g. Claude Desktop).
6. **Files never pass through an agent's context as tool results.** Agent file delivery is
   via MCP **Resources**; presigned S3 URLs are confined to the browser/download path.

---

## 3. System shape (C4 — Context)

```
        ┌────────────┐         ┌──────────────────┐
        │  Human user│         │  Agent user      │
        │  (browser) │         │  (Claude Desktop)│
        └─────┬──────┘         └────────┬─────────┘
              │ HTTPS (OIDC)            │ Streamable HTTP (OAuth)
              ▼                         ▼
        ┌───────────────────────────────────────────┐
        │            Artifact Hub (this system)      │
        │   SPA (S3+CloudFront)  +  Backend (ECS)    │
        └───────────────────────────────────────────┘
              │            │            │           │
              ▼            ▼            ▼           ▼
          ┌───────┐   ┌────────┐   ┌───────┐   ┌───────┐
          │ Auth0 │   │  RDS   │   │  S3   │   │  SES  │
          │ (IdP) │   │Postgres│   │(files)│   │(email)│
          └───────┘   └────────┘   └───────┘   └───────┘
```

## 4. System shape (C4 — Container)

```
   Browser SPA ──────▶ CloudFront ──▶ S3 (static site)
        │ XHR /api/*
        ▼
   ┌──────────────────────────────────────────────────────┐
   │  Application Load Balancer (TLS)                       │
   └───────────────┬──────────────────────────────────────┘
                   ▼
   ┌──────────────────────────────────────────────────────┐
   │  Backend container (Node + TypeScript, Express)        │  ECS Fargate
   │                                                        │  (autoscaled,
   │   adapters/http   →  /api/*   (SPA + admin)            │   many replicas)
   │   adapters/mcp    →  /mcp     (Streamable HTTP)        │
   │            \         /                                 │
   │             core (domain: artifacts, authz, sharing,   │
   │                    comments, invitations, groups)      │
   └───────┬───────────────┬───────────────┬───────────────┘
           │ Prisma        │ IAM role      │ Management API / OIDC
           ▼               ▼               ▼
      RDS Postgres      S3 (private)     Auth0        + SES (email)
      (private subnet)  Block Public     (one IdP,      (invitations)
                        Access on        two roles)
```

The backend is a **modular monolith**: one deployable serving both `/api/*` and `/mcp`,
sharing one `core` domain layer. See `06` (API) and `05` (MCP) for the two adapters.

---

## 5. Decision log

| # | Area | Decision | Status | Doc |
|---|------|----------|--------|-----|
| 1 | Backend shape | Modular monolith (API + MCP, shared `core`) | DECIDED | 01/05/06 |
| 2 | Backend framework | **Express** + zod validation | DECIDED | 06 |
| 3 | MCP transport | Streamable HTTP, single `/mcp` (not SSE) | DECIDED | 05 |
| 4 | Backend host | ECS Fargate + ALB (autoscaled) | DECIDED | 07 |
| 5 | Frontend host | S3 + CloudFront (AWS-native) | DECIDED | 07 |
| 6 | Database | RDS PostgreSQL, private subnet | DECIDED | 04/07 |
| 7 | ORM / migrations | **Prisma** (`migrate dev`/`deploy`/`db seed`) | DECIDED | 04 |
| 8 | Object storage | S3, private (Block Public Access) | DECIDED | 07 |
| 9 | Identity provider | Auth0 (OIDC humans + MCP OAuth RS) | DECIDED | 02 |
| 10 | Anonymous access | **Not allowed** — all viewers authenticated | DECIDED | 03 |
| 11 | Access policy scope | **One owner-controlled policy per artifact** | DECIDED | 03 |
| 12 | Expiry options | 24h / 7d / 30d / never | DECIDED | 03/04 |
| 13 | Revocation | Edit policy → server re-eval kills old links | DECIDED | 03 |
| 14 | Share links | Pure locators (`/s/<token>`), no per-link policy | DECIDED | 03/06 |
| 15 | Groups | App-managed in Postgres, admin-assigned, immutable | DECIDED | 02/04 |
| 16 | Admin area | `/admin` + `/admin/users`, backend admin routes | DECIDED | 02/06 |
| 17 | Email | AWS SES (invitations) | DECIDED | 02/07 |
| 18 | Initial admins | Seeded from `INITIAL_ADMIN_EMAILS` (idempotent) | DECIDED | 02 |
| 19 | Comments | Any viewer reads; commenting requires auth | DECIDED | 03/06 |
| 20 | MCP file delivery | Resources (`artifact://<id>`); tools metadata-only | DECIDED | 05 |
| 21 | Presigned URLs | Browser/download path only; ~60s; never in MCP | DECIDED | 03/05 |
| 22 | Review summary | MCP **Prompt** (client-side LLM), backend LLM-free | DECIDED | 05 |
| 23 | Artifact relationships | `artifact_relationships` table (additive) | DECIDED | 04 |
| 24 | Artifact metadata | `metadata` JSONB + structured tags | DECIDED | 04 |
| 25 | Orchestration | Transactional outbox + idempotency; no LangGraph | DECIDED | 02/07 |
| 26 | Repo layout | Monorepo (yarn workspaces), path-filtered CI | DECIDED | 08 |
| 27 | HTML sandboxing | Serve off sandbox origin + strict CSP | DECIDED | 06 |
| 28 | Authz model | Owner-based | DECIDED | 03 |

Items that were **OPEN** in the WIP doc (backend host, frontend host, authz model, HTML
sandboxing) are now all closed above.

---

## 6. Glossary

- **Artifact** — a stored file (PDF/HTML/image/docx/mmd/md/…) plus metadata, owned by one user.
- **Owner / Publisher** — the user who published an artifact; the only one who can change its policy.
- **Access policy** — the artifact's single audience + expiry rule.
- **Audience type** — `public_authenticated` | `specific_users` | `user_groups`.
- **Group** — an app-managed collection of users (e.g. Product, Development); membership is
  admin-assigned at invite time and immutable by the user.
- **Grant** — an entry giving a specific user or group access to an artifact (backs
  `specific_users` / `user_groups`).
- **Share link** — a locator URL (`/s/<token>`) resolving to an artifact id; access is decided
  by the artifact's current policy at redemption, not by the link itself.
- **Invitation** — an admin-issued, tokenized email invite carrying target email, group(s) and role.
- **Comment / Review** — an attributable note on an artifact (body, author, date).

---

## 7. Requirements traceability matrix

Every requirement maps to at least one design doc **and** one BDD scenario. No orphans.

| Requirement | Design doc(s) | BDD scenario(s) |
|-------------|---------------|-----------------|
| No anonymous access | 03 | reviewer-access-via-ui, access-denied-after-expiry |
| Per-artifact, owner-only, revocable policy | 03, 04 | publisher-revoke-and-my-artifacts, access-denied-after-expiry |
| Expiry buckets (24h/7d/30d/never) | 03, 04, 05 | publisher-publish-with-policy |
| Audience: public / specific_users / user_groups | 03, 04 | publisher-publish-with-policy, reviewer-access-via-ui |
| Groups (app-managed, immutable) | 02, 04 | admin-invite-user |
| Admin area + email invites | 02, 06, 07 | admin-invite-user |
| Multiple seeded initial admins | 02 | admin-invite-user (bootstrap note) |
| Comments: any viewer reads, auth to write, shows body/author/date | 03, 06 | reviewer-access-via-ui, publisher-revoke-and-my-artifacts |
| "My Artifacts" survives expiry for owner | 03, 06 | publisher-revoke-and-my-artifacts |
| MCP "shared with me (last 24h)" markdown table | 05 | reviewer-access-via-mcp |
| Download via MCP Resource, never a tool result | 05 | reviewer-access-via-mcp |
| Download via frontend (presigned) | 03, 06 | reviewer-access-via-ui |
| Review summary for Claude Desktop | 05 | reviewer-access-via-mcp |
| Artifact relationships | 04 | (storage + read API; no v1 UI journey) |
| Artifact metadata | 04, 05, 06 | publisher-publish-with-policy |
| High concurrency | 07 | (non-functional; load-tested, see 09) |
| Cost optimisation at scale (S3 lifecycle) | 07 | (non-functional) |
| Observability | 10 | (non-functional) |

---

## 8. Deferred (noted, not in v1)

Artifact editing and deletion (explicitly out of scope). Server-side AI: auto-tagging,
embeddings / semantic search, server-generated summaries. CDN signed cookies. Experimental
Skills-over-MCP primitive. See `10` for the deferred prod-hardening list (rate limiting,
backups, content scanning).
