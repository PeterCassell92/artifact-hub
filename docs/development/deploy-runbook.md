# Deploy Runbook — Netlify (frontend) + Fly.io (backend + MCP)

*Status: operational. Related: [`../architecture/07-infrastructure-and-iac.md`](../architecture/07-infrastructure-and-iac.md)
(topology), [`../architecture/08-deployment-pipeline.md`](../architecture/08-deployment-pipeline.md)
(CI + deploy flow).*

This runbook is the **source of truth for provisioning and deploying** Artifact Hub. We deliberately
run **no Terraform/IaC** — the committed [`fly.toml`](../../fly.toml) + [`netlify.toml`](../../netlify.toml)
plus these CLI steps are the whole "infrastructure definition." Do the **first-time setup** once;
thereafter use the **routine deploy** section.

**Prerequisites:** `flyctl` (`fly`) and `netlify` CLIs installed and logged in
(`fly auth login`, `netlify login`); Docker (for local image builds); an Auth0 tenant; a Resend
account.

---

## 1. First-time setup (once)

### 1.1 Fly app (backend + `/mcp`)

```bash
# From the repo root. fly.toml is already committed, so DO NOT let launch overwrite it.
fly launch --no-deploy --copy-config --name artifact-hub-backend --region lhr
```

- `--copy-config` uses the committed `fly.toml`; `--no-deploy` because secrets/DB/storage aren't set
  up yet. Pick your `--region` (e.g. `lhr`, `iad`); it must match the DB/storage region for low
  latency.

### 1.2 Fly Managed Postgres

```bash
fly mpg create --name artifact-hub-db --region lhr
# Attach it to the app — this sets DATABASE_URL as a fly secret on the backend app:
fly mpg attach artifact-hub-db --app artifact-hub-backend
```

Confirm `DATABASE_URL` is now present: `fly secrets list --app artifact-hub-backend`.

### 1.3 Tigris object storage

```bash
fly storage create --name artifact-hub-artifacts --app artifact-hub-backend
```

This provisions a **private** S3-compatible bucket and injects these as **fly secrets** on the app:
`BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`
(`auto`). The backend's AWS SDK v3 S3 client reads these directly (see
[`apps/backend/src/env.ts`](../../apps/backend/src/env.ts)). No public access is enabled — this
preserves the security invariant (presigned URLs browser-only; agent bytes via server-side read).

### 1.4 Resend (invitation email)

1. Create a Resend account, add and **verify your sending domain** (DKIM/SPF DNS records).
2. Create an API key.
3. Set the SMTP secrets on the app:

```bash
fly secrets set \
  EMAIL_TRANSPORT=smtp \
  SMTP_HOST=smtp.resend.com \
  SMTP_PORT=465 \
  SMTP_SECURE=true \
  SMTP_USER=resend \
  SMTP_PASS=<RESEND_API_KEY> \
  EMAIL_FROM="Artifact Hub <no-reply@yourdomain>" \
  --app artifact-hub-backend
```

### 1.5 Auth0 (unchanged tenant, new origins)

The Auth0 tenant itself is untouched by this migration — only the URLs and secrets change:

- **Allowed Callback URLs / Allowed Web Origins / Allowed Logout URLs / CORS** → add the **Netlify**
  SPA origin (e.g. `https://artifact-hub.netlify.app` or your custom domain).
- The **MCP OAuth Resource Server** audience is unchanged; the Protected Resource Metadata now
  advertises the **Fly** `/mcp` URL (`https://artifact-hub-backend.fly.dev/mcp`).
- Set the Auth0 secrets on the app:

```bash
fly secrets set \
  AUTH0_DOMAIN=your-tenant.eu.auth0.com \
  AUTH0_API_AUDIENCE=https://api.artifact-hub.example \
  AUTH0_MCP_AUDIENCE=https://mcp.artifact-hub.example \
  AUTH0_CLIENT_SECRET=<...> \
  AUTH0_MGMT_CLIENT_ID=<...> AUTH0_MGMT_CLIENT_SECRET=<...> \
  INITIAL_ADMIN_EMAILS="you@example.com" \
  --app artifact-hub-backend
```

### 1.6 First backend deploy + DB bootstrap

```bash
fly deploy --app artifact-hub-backend            # builds apps/backend/Dockerfile (root context)
# release_command runs `prisma migrate deploy` automatically before traffic shifts.
# Seed initial groups + admins once (idempotent):
fly ssh console --app artifact-hub-backend -C "yarn workspace backend db:seed"
```

Verify:

```bash
curl https://artifact-hub-backend.fly.dev/healthz     # -> 200
curl https://artifact-hub-backend.fly.dev/readyz      # -> 200 (DB reachable + migrations applied)
fly logs --app artifact-hub-backend                   # -> "backend listening (api + mcp)"
```

### 1.7 Netlify site (SPA)

```bash
netlify init          # link the repo; build settings come from netlify.toml
# Set the SPA's public build vars (VITE_* only — these are embedded in the bundle, not secret):
netlify env:set VITE_API_BASE_URL "https://artifact-hub-backend.fly.dev/api"
netlify env:set VITE_AUTH0_DOMAIN "your-tenant.eu.auth0.com"
netlify env:set VITE_AUTH0_CLIENT_ID "<spa-client-id>"
# ...any other VITE_AUTH0_* the SPA needs
netlify deploy --prod
```

`netlify.toml` builds `contracts` then `frontend` and publishes `apps/frontend/dist` with an SPA
fallback redirect. After deploy, confirm the SPA loads over HTTPS and a deep-link refresh works.

> **Loop back:** once the Netlify URL is known, ensure it's in Auth0's allowed origins (§1.5) and in
> the backend CORS allow-list.

---

## 2. Routine deploy

Both hosts also support push-to-deploy via Git integration (path-filtered, see
[08](../architecture/08-deployment-pipeline.md)); the manual CLI equivalents are:

```bash
# Backend (apps/backend/** or packages/contracts/** changed):
fly deploy --app artifact-hub-backend        # rebuild image; release_command migrates; rolling update

# Frontend (apps/frontend/** or packages/contracts/** changed):
netlify deploy --prod                        # rebuild SPA; publish apps/frontend/dist
```

A new DB migration is applied automatically by the Fly `release_command` **before** new machines
take traffic — write migrations expand/contract so the rolling update is never incompatible (see the
`prisma-migrate` skill).

---

## 3. Scaling & operations

```bash
fly scale count 3 --app artifact-hub-backend          # run N machines behind fly-proxy
fly scale vm shared-cpu-1x --memory 512 --app ...     # change machine size
fly secrets set KEY=value --app ...                   # rotate/add a runtime secret (triggers redeploy)
fly logs --app ...                                    # tail logs
fly ssh console --app ...                             # shell into a machine
fly mpg ...                                            # DB backups/restore per Fly MPG docs
```

Concurrency limits (the ALB request-count-per-target analogue) live in `fly.toml` under
`[http_service.concurrency]`; raise `soft_limit`/`hard_limit` or `min_machines_running` if the app
saturates.

---

## 4. Notes / gotchas

- **`release_command` needs Prisma in the image.** `prisma migrate deploy` requires the Prisma CLI +
  `prisma/schema.prisma` + `prisma/migrations/` to be present in the runtime image. Confirm
  [`apps/backend/Dockerfile`](../../apps/backend/Dockerfile) ships them (keep the Prisma CLI in the
  runtime stage or run migrations as an explicit pre-deploy step otherwise).
- **Regions must align.** Keep the app, Fly MPG, and Tigris in the same primary region for latency.
- **Secrets never in the repo/image.** Backend secrets → `fly secrets`; frontend has only public
  `VITE_*` build vars. Dev uses git-ignored `.env` (see [email-catcher.md](email-catcher.md) and the
  `.env.example` files).
- **Dev object storage.** Locally, point the S3 client at **MinIO** (S3-compatible) or a throwaway
  dev Tigris bucket — same SDK, different endpoint.
