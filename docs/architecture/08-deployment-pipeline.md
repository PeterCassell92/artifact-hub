# 08 — Repository Layout & Deployment Pipeline

*Status: design. Related: [07](07-infrastructure-and-iac.md), [09](09-testing-strategy.md). See also
the [deploy runbook](../development/deploy-runbook.md).*

One **monorepo** with **path-filtered CI**, deploying the backend (**Fly.io**) and frontend
(**Netlify**) independently. CI is GitHub Actions (the repo already lives on GitHub; the GitHub MCP
is wired via `.mcp.json`). Deployment itself is done via the **`fly` and `netlify` CLIs** — there is
no Terraform/IaC layer to plan/apply (see [07](07-infrastructure-and-iac.md)).

---

## 1. Monorepo layout (yarn workspaces)

```
artifact-hub/
├── apps/
│   ├── backend/          Express + MCP server, Prisma, core domain
│   │   ├── src/core/         domain: artifacts, authz (03), sharing, comments, invites, groups
│   │   ├── src/adapters/http one Express router mounts /api/*  (06)
│   │   ├── src/adapters/mcp  StreamableHTTP /mcp  (05)
│   │   ├── prisma/           schema.prisma, migrations/, seed.ts
│   │   └── Dockerfile
│   └── frontend/         React SPA — Redux Toolkit + Tailwind (admin + gallery + artifact detail)
├── packages/
│   └── contracts/        shared zod schemas + TS types for the API/MCP contract
├── fly.toml              Fly app config (backend + /mcp) — see 07
├── netlify.toml          Netlify build config (SPA) — see 07
├── docs/                 these design docs
├── .github/workflows/    CI (below)
├── package.json          root: private, workspaces: ["apps/*", "packages/*"], root scripts
└── yarn.lock
```

Each app (`apps/backend`, `apps/frontend`) and `packages/contracts` has its **own
`package.json`**; the **root `package.json`** declares the workspaces and root fan-out scripts
(`yarn test`, `yarn lint`, `yarn typecheck`). See `CLAUDE.md` for the full script catalogue.

- `packages/contracts` is imported by both `apps/backend` and `apps/frontend`, so the API/MCP
  contract is type-checked on both sides. A change here triggers both deploy paths.
- **Why monorepo (not two repos)**: shared types, atomic cross-cutting PRs, one place for config;
  path filters still give independent deploy cadence. **`fly.toml` and `netlify.toml` coexist at the
  root**, so a single repo drives both hosts. Splitting later is a lift-and-shift.

---

## 2. CI (path-filtered) + deploy

```
.github/workflows/
├── ci.yml            on PR: lint, typecheck, unit + integration tests (all packages)
├── deploy-backend.yml    on push to main + paths: apps/backend/** , packages/contracts/**
└── deploy-frontend.yml   on push to main + paths: apps/frontend/**, packages/contracts/**
```

There is **no `infra.yml`** — the platform config lives in `fly.toml` / `netlify.toml` and changes
ship with the app that owns them.

### `ci.yml` (every PR)
1. `yarn install --immutable`
2. `yarn lint` + `yarn typecheck`
3. `yarn test` — backend core unit + API integration (Testcontainers Postgres) + MCP
   in-memory/HTTP, and frontend React component tests (see [09](09-testing-strategy.md)). Blocks
   merge on failure.

### Backend deploy — Fly (`deploy-backend.yml`, or manual `fly deploy`)
1. Install, build, run tests.
2. **`fly deploy`** builds `apps/backend/Dockerfile` (root build context) and ships the image to Fly.
3. Fly runs the **`release_command`** = **`prisma migrate deploy`** in a temporary machine
   (applies pending migrations, no prompts) **before** the new machines take traffic.
4. **Rolling machine update**, health-checked on **`/readyz`**; `fly-proxy` shifts traffic only to
   machines that pass the check.
5. **Smoke test**: hit `/healthz`, `/readyz`, and a lightweight authenticated `/api` probe.

CI authenticates to Fly with a `FLY_API_TOKEN` (GitHub Actions secret); a manual `fly deploy` from a
developer machine uses the logged-in `flyctl` session. See the
[deploy runbook](../development/deploy-runbook.md).

### Frontend deploy — Netlify (`deploy-frontend.yml`, or Netlify Git integration)
1. Build the SPA — `yarn install && yarn workspace contracts build && yarn workspace frontend build`
   (contracts must build first) — with env-specific `VITE_API_BASE_URL` / `VITE_AUTH0_*`.
2. **Publish `apps/frontend/dist`** to Netlify (`netlify deploy --prod`), which handles CDN
   distribution, cache invalidation, and TLS automatically.

The build command + publish dir live in `netlify.toml`. The simplest setup connects the repo to
Netlify's Git integration (path-filtered to `apps/frontend/**` + `packages/contracts/**`) so pushes
to `main` auto-deploy; a manual `netlify deploy --prod` is the fallback.

---

## 3. Deploy auth from CI

- **Fly:** a `FLY_API_TOKEN` GitHub Actions secret (scoped to the app). No cloud IAM to assume.
- **Netlify:** a `NETLIFY_AUTH_TOKEN` + `NETLIFY_SITE_ID`, or the Netlify GitHub App for
  Git-integration deploys.

Runtime **app secrets are never handled by CI** — they live in `fly secrets` (backend) and Netlify
env vars (public `VITE_*` only) and are fetched by the platform at boot/build. See
[07](07-infrastructure-and-iac.md) §2.

## 4. Environment promotion

- A single production Fly app + Netlify site is the v1 target. If a staging environment is added,
  it's a **separate Fly app** (e.g. `artifact-hub-staging`) selected with `fly deploy --app` /
  `--config`, and a Netlify deploy context / separate site — not a Terraform workspace.
- `main` deploys on merge; production-gating (manual approval) is done via a GitHub Environment
  protection rule on the deploy job if desired.

## 5. Migration safety

- **`prisma migrate deploy`** runs as the Fly **`release_command`**, i.e. **before** the new
  machines take traffic; migrations are written to be backward-compatible with the currently-running
  version (expand/contract) so the rolling deploy never serves against an incompatible schema. See
  the `prisma-migrate` skill for the authoring rules.
- The `release_command` runs with the app's `fly secrets` (so `DATABASE_URL` is available) and needs
  the Prisma CLI + `schema.prisma` + `migrations/` present in the image — see the Dockerfile note in
  [07](07-infrastructure-and-iac.md) / the runbook.

## 6. Seed / bootstrap on first deploy

- The idempotent `prisma db seed` (initial groups + `INITIAL_ADMIN_EMAILS` admins, see
  [02](02-auth-identity-and-admin.md) §5) runs **once** after the first successful `migrate deploy`
  — e.g. `fly ssh console -C "yarn workspace backend db:seed"` or a one-shot machine. Idempotency
  makes it safe to re-run.
