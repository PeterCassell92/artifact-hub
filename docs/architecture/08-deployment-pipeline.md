# 08 — Repository Layout & Deployment Pipeline

*Status: design. Related: [07](07-infrastructure-and-iac.md), [09](09-testing-strategy.md).*

One **monorepo** with **path-filtered CI**, deploying the backend (ECS) and frontend
(S3/CloudFront) independently. CI/CD is GitHub Actions (the repo already lives on GitHub; the
GitHub MCP is wired via `.mcp.json`).

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
│   └── frontend/         SPA (admin + gallery + artifact detail)
├── packages/
│   └── contracts/        shared zod schemas + TS types for the API/MCP contract
├── infra/                Terraform (see 07)
├── docs/                 these design docs
├── .github/workflows/    CI/CD (below)
├── package.json          root: private, workspaces: ["apps/*", "packages/*"], root scripts
└── yarn.lock
```

Each app (`apps/backend`, `apps/frontend`) and `packages/contracts` has its **own
`package.json`**; the **root `package.json`** declares the workspaces and root fan-out scripts
(`yarn test`, `yarn lint`, `yarn typecheck`). See `CLAUDE.md` for the full script catalogue.

- `packages/contracts` is imported by both `apps/backend` and `apps/frontend`, so the API/MCP
  contract is type-checked on both sides. A change here triggers both deploy jobs.
- **Why monorepo (not two repos)**: shared types, atomic cross-cutting PRs, one set of secrets;
  path filters still give independent deploy cadence. Splitting later is a lift-and-shift.

---

## 2. Workflows (path-filtered)

```
.github/workflows/
├── ci.yml            on PR: lint, typecheck, unit + integration tests (all packages)
├── deploy-backend.yml    on push to main + paths: apps/backend/** , packages/contracts/**
├── deploy-frontend.yml   on push to main + paths: apps/frontend/**, packages/contracts/**
└── infra.yml             on push to main + paths: infra/**  (terraform plan/apply, gated)
```

### `ci.yml` (every PR)
1. `yarn install --immutable`
2. `yarn lint` + `yarn typecheck`
3. `yarn test` — backend core unit + API integration (Testcontainers Postgres) + MCP
   in-memory/HTTP, and frontend React component tests (see `09`). Blocks merge on failure.

### `deploy-backend.yml` (push to `main`, backend/contracts paths)
1. Install, build, run tests.
2. `docker build` the backend image → **push to ECR** (tagged with git SHA).
3. **`prisma migrate deploy`** against the target DB (applies pending migrations, no prompts).
4. `terraform plan` for `envs/<env>` (compute module picks up new image tag); **gated apply**
   (manual approval for prod, auto for dev).
5. **ECS rolling deploy** (new task definition, health-checked on `/readyz`); ALB shifts traffic
   only to healthy tasks.
6. **Smoke test**: hit `/healthz`, `/readyz`, and a lightweight authenticated `/api` probe.

### `deploy-frontend.yml` (push to `main`, frontend/contracts paths)
1. Build the SPA (`yarn workspace frontend build`) with env-specific API/base URLs.
2. **S3 sync** the static build to the site bucket.
3. **CloudFront invalidation** for changed paths.

### `infra.yml` (push to `main`, `infra/**`)
- `terraform fmt -check`, `validate`, `plan`; **gated apply**. Keeps infra changes reviewable and
  separate from app deploys.

---

## 3. AWS auth from CI — OIDC, no static keys

GitHub Actions authenticates to AWS via **OIDC role assumption** (an IAM role trusting the
GitHub OIDC provider, scoped to this repo/branch). No long-lived AWS keys in GitHub secrets.

## 4. Environment promotion

- `dev` deploys automatically on merge to `main`.
- `prod` requires a **manual approval** gate (GitHub Environments protection) before
  `terraform apply` and the ECS deploy.
- The same image SHA promotes from dev to prod (build once, deploy many).

## 5. Migration safety

- `prisma migrate deploy` runs **before** the new tasks take traffic; migrations are written to
  be backward-compatible with the currently-running version (expand/contract) so the rolling
  deploy never serves against an incompatible schema. See the `prisma-migrate` skill for the
  authoring rules.

## 6. Seed / bootstrap on first deploy

- The idempotent `prisma db seed` (initial groups + `INITIAL_ADMIN_EMAILS` admins, `02` §5) runs
  as a one-shot task after the first successful `migrate deploy`. Idempotency makes it safe to
  leave enabled on subsequent deploys.
