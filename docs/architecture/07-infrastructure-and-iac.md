# 07 — Infrastructure & Deployment

*Status: design. Related: [06](06-api-design.md), [08](08-deployment-pipeline.md),
[10](10-observability.md). See also the [deploy runbook](../development/deploy-runbook.md).*

The system runs on a **lightweight, CLI-deployed stack** chosen to ship fast within a short build
window: **Netlify** hosts the SPA and **Fly.io** runs the backend (Express serving `/api/*` **and**
the Streamable-HTTP `/mcp` in one long-lived container). High concurrency is still a system
requirement — Fly's edge proxy load-balances across horizontally-scaled machines.

We intentionally **do not maintain a full Infrastructure-as-Code layer** (no Terraform). The
resources are few and provisioned once via the `fly`/`netlify` CLIs; the reproducible source of
truth is the committed **`fly.toml`** + **`netlify.toml`** plus the step-by-step
[deploy runbook](../development/deploy-runbook.md). This trades reproducible multi-account IaC for
speed — an accepted trade-off for this project's scope.

---

## 1. Topology

```
        Netlify edge (CDN + TLS)          Fly Anycast edge (fly-proxy, TLS)
                │                                     │
        SPA static assets                  ┌──────────┴───────────┐
        (apps/frontend/dist)               │  Fly app: backend    │  N machines, autoscaled
                                           │  Express /api/* + /mcp│  (Firecracker microVMs)
                                           └───┬────────┬─────┬────┘
                                     Prisma │        │     │ presigned PUT/GET (browser, ~60s)
                                            ▼        │     │ server-side GetObject (held key, MCP)
                                   Fly Managed        │     ▼
                                   Postgres (MPG)     │   Tigris (S3-compatible object store)
                                                      │   private bucket; own domain = sandbox origin
                                   Auth0 (ext)  ◀──────┴─────▶  Resend (SMTP, invitation email)
                                   OIDC login (SPA) + MCP OAuth Resource Server
```

- **Frontend:** Netlify serves the pre-built Vite SPA (`apps/frontend/dist`) from its CDN with
  managed TLS and a custom domain. Replaces the old S3 + CloudFront SPA distribution.
- **Backend + MCP:** a single Fly app runs the `apps/backend/Dockerfile` container on port 3000.
  `fly-proxy` (Fly's Anycast edge) terminates TLS and load-balances across machines. One process
  serves both `/api/*` and `/mcp` — see [05](05-mcp-server-design.md).
- **Database:** **Fly Managed Postgres** (`fly mpg`), colocated with the app for low latency, with
  managed backups. Reached by Prisma over the Fly private network (`.flycast`/`.internal`).
- **Object storage:** **Tigris** (S3-compatible, provisioned via `fly storage create`). The bucket
  is private; the backend holds a scoped access key (in `fly secrets`). Reads use the same two
  strictly-separated paths as before — presigned URL for the browser, server-side `GetObject` for
  the MCP resource. Tigris's own domain doubles as the **isolated sandbox origin** for HTML
  artifacts (see §5).
- **Email:** **Resend** over SMTP (via the existing nodemailer transport) for admin invitation
  emails. Note the magic-link email itself is sent by **Auth0's passwordless connection**, not our
  backend — Resend only carries our own invitation emails.
- **IdP:** **Auth0** (unchanged, external, cloud-agnostic) — SPA login via OIDC + PKCE and the
  `/mcp` OAuth Resource Server. Only its credentials move (to `fly secrets`); the tenant is
  untouched by this migration. See [02](02-auth-identity-and-admin.md).

---

## 2. Deploy configuration & CLI (no IaC)

Two committed config files at the repo root are the whole "infrastructure definition":

```
fly.toml         Fly app: build (apps/backend/Dockerfile), internal_port 3000,
                 release_command = prisma migrate deploy, health check /readyz,
                 http_service concurrency limits, machine size, auto start/stop
netlify.toml     Netlify build: monorepo-aware command (build contracts → frontend),
                 publish apps/frontend/dist, NODE_VERSION, SPA fallback redirect
```

Provisioning is a one-time set of CLI steps (fully scripted in the
[deploy runbook](../development/deploy-runbook.md)): `fly launch`, `fly mpg create`,
`fly storage create` (Tigris), `fly secrets set …`, Resend domain verification, and
`netlify init` / `netlify deploy --prod`. There is **no `infra/` directory** and no Terraform state
to manage.

### Secrets strategy (three layers — pick the store by where the secret is consumed)

| Layer | Store | What lives there | How it's consumed |
|-------|-------|------------------|-------------------|
| **Runtime (backend)** | **`fly secrets`** | `DATABASE_URL` (Fly MPG), Tigris access key + secret + endpoint + bucket, Auth0 client secret + Management API creds, `SMTP_PASS` (Resend API key), `INITIAL_ADMIN_EMAILS`, Sentry DSN | Encrypted at rest by Fly; injected as env vars into the machine at boot; never in the image |
| **Frontend (build)** | **Netlify env vars** | `VITE_API_BASE_URL` (Fly backend URL), `VITE_AUTH0_*` | Read at build time; only `VITE_`-prefixed vars are embedded — all are public by nature (no secrets here) |
| **Dev (local)** | **git-ignored `.env`** | Local Postgres password, MailCatcher SMTP, dev object-store creds (MinIO or a dev Tigris bucket) | Root `.env` (docker-compose) + `apps/*/.env`; `.env.example` committed as the template |

**Rule of thumb:** backend runtime secrets → `fly secrets` (never in the image, never in the repo);
frontend build vars → Netlify env (public `VITE_*` only); dev → `.env`. The single long-lived
credential of note is the **Tigris access key** — scoped to the artifacts bucket and rotatable via
`fly storage`.

---

## 3. Compute & concurrency

- **Fly machines** (Firecracker microVMs) run the backend container. Scale horizontally with
  `fly scale count N`; `fly-proxy` distributes requests across machines (and regions if added).
- **Concurrency limits** are set in `fly.toml` under `[http_service.concurrency]` (soft/hard
  request limits per machine) — the analogue of ALB request-count-per-target. Reaching the soft
  limit triggers `auto_start_machines` to bring up more capacity; idle machines can
  `auto_stop_machines` to save cost, with `min_machines_running` keeping a warm floor.
- **Streamable HTTP `/mcp` is stateless-friendly**, so it scales horizontally exactly like the API.
- **Why a long-running container (not Lambda/functions):** OAuth flows + streaming suit a persistent
  process and avoid cold-start/timeout friction on the MCP endpoint. Fly **satisfies** this
  requirement natively — it's the reason we run the backend on Fly rather than an edge-function host.
- **Concurrency vs. an AWS ALB:** for this workload the two are effectively equivalent — a single
  Node event loop absorbs most concurrency and machines handle the rest. ALB's edge is only at
  extreme scale and richer AWS-native autoscaling policies, neither of which this project needs.

---

## 4. Storage & cost

- Artifacts are **write-once** (no edit/delete in v1). **Tigris auto-tiers** hot vs. cold objects
  transparently — there are no manual lifecycle transition rules to author (unlike S3
  Standard-IA/Glacier). Object **expiry/deletion**, if ever needed, is available via
  S3-compatible lifecycle rules.
- **Egress is free** on Tigris, which matters for a download-heavy sharing app (S3 charges per GB
  out). At the expected scale (~100s of small artifacts) storage + operations cost is negligible /
  within the free tier.
- **Fly Managed Postgres** provides automated backups; retention configured per the runbook.

---

## 5. Networking & security summary

- **Postgres:** reached only over Fly's private network (`.flycast`); not exposed publicly. The
  `DATABASE_URL` lives in `fly secrets`.
- **Object store (Tigris):** bucket is **private by default**; all access is via short-lived
  presigned URLs (browser) or the held scoped key server-side (MCP resource) over TLS. The
  security invariant is unchanged from the S3 design — **presigned URLs are browser-only and are
  pure locators, never bearer tokens of access**; agent bytes come only from a server-side read.
  See [03](03-authorization-and-access-control.md) §7.
- **HTML sandbox origin:** the isolated origin that renders untrusted HTML artifacts (previously a
  second CloudFront distribution) is provided by **Tigris's own domain**
  (`*.fly.storage.tigris.dev` or a dedicated sandbox subdomain), which is a **separate origin** from
  both the Netlify app and the Fly API. The SPA renders HTML artifacts in a `sandbox`ed `<iframe>`
  pointing at a presigned Tigris URL, with a strict CSP — achieving the same origin isolation the
  CloudFront sandbox gave us, for free. See [03](03-authorization-and-access-control.md) §7 and
  [06](06-api-design.md).
- **Secrets:** never in env files or images; `fly secrets` (backend) + Netlify env (public `VITE_*`).
- **TLS:** terminated at both edges (Netlify for the SPA, `fly-proxy` for the API/MCP);
  `force_https` in `fly.toml`.
- **CORS:** the SPA (Netlify origin) and API/MCP (Fly origin) are different origins, so the backend
  must allow the Netlify origin, and Auth0's Allowed Web Origins / Callback URLs must list it. See
  [08](08-deployment-pipeline.md) and the runbook.

---

## 6. Reliability building blocks

- The **transactional outbox** (see [02](02-auth-identity-and-admin.md) §6) is just DB rows + a
  drain loop in the backend — no extra infrastructure beyond the existing Postgres. External calls
  (Resend, Auth0) are retried with idempotency keys.
- **Health/readiness:** `GET /healthz` (liveness) and `GET /readyz` (DB reachable + migrations
  applied) gate Fly traffic and rolling deploys — `fly.toml` health-checks `/readyz`, and Fly shifts
  traffic to a new machine only once it passes. See [06](06-api-design.md) §7 and
  [08](08-deployment-pipeline.md).

---

## 7. What's provisioned via CLI vs. configured elsewhere

- **Fly CLI:** the backend app + machines, Fly Managed Postgres, Tigris bucket + access key, and all
  `fly secrets`. Captured declaratively in `fly.toml` where possible; the rest documented in the
  runbook.
- **Netlify CLI / UI:** the SPA site, build settings (or `netlify.toml`), env vars, and domain.
- **Out of band (documented, not scripted):** the **Auth0 tenant** (applications, API, DCR,
  Management API app) — created in Auth0 and referenced by secret; the **Resend** account + verified
  sending domain (DKIM/SPF); the **Sentry** project. All three are external SaaS configured once per
  the runbook.
