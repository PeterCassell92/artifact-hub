---
name: prisma-migrate
description: How and when to run Prisma migrations for Artifact Hub's dev, CI, and prod environments. Use whenever the Prisma schema (apps/backend/prisma/schema.prisma) changes, when the dev database needs migrating/resetting/seeding, or when wiring migrations into CI/CD. Covers migrate dev vs migrate deploy, reset + seed, and expand/contract safety rules.
---

# Prisma migrate (Artifact Hub)

Prisma is the ORM + migration tool. The schema lives at `apps/backend/prisma/schema.prisma`;
migrations in `apps/backend/prisma/migrations/`; seed at `apps/backend/prisma/seed.ts`. See
[docs/architecture/04-data-model.md](../../../docs/architecture/04-data-model.md).

Run all commands from `apps/backend` (or via `yarn workspace backend <script>` from the repo
root). The backend `package.json` wraps these as scripts (e.g. `yarn workspace backend db:migrate`).

## When to use which command

| Situation | Command | Notes |
|-----------|---------|-------|
| Changed `schema.prisma` in local dev | `yarn prisma migrate dev --name <change>` | Creates a new migration, applies it to the dev DB, regenerates the client. **This is the normal dev loop.** |
| Rebuild dev data from scratch | `yarn prisma migrate reset` then `yarn prisma db seed` | **Destroys** the dev DB, re-applies all migrations, re-seeds. Dev/test only. |
| Apply pending migrations in CI/prod | `yarn prisma migrate deploy` | Applies committed migrations, no prompts, never generates new ones. Used in the deploy pipeline (08) **before** new tasks take traffic. |
| Regenerate client after pulling changes | `yarn prisma generate` | Run if the client is stale but no schema change is yours. |
| Inspect drift | `yarn prisma migrate status` | Shows applied vs pending. |

## The golden rules

1. **Never edit a migration that has been applied/committed.** Add a *new* migration instead.
   Editing history breaks `migrate deploy` for everyone.
2. **`migrate dev` only in local development.** Never point it at a shared/prod DB (it can create
   and even reset). CI/prod uses `migrate deploy`.
3. **Write migrations expand/contract** so a rolling deploy is safe (old + new code run
   simultaneously during rollout — see 08 §5):
   - Expand: add nullable columns / new tables first; deploy; backfill.
   - Contract: drop/rename only after all running code stopped using the old shape (a later migration).
   - Avoid a single migration that renames/drops a column the current production code still reads.
4. **Seed is idempotent.** `seed.ts` seeds initial groups and the `INITIAL_ADMIN_EMAILS` admins
   (see 02 §5); re-running must not duplicate. Guard inserts with upserts / existence checks.
5. **Commit the generated migration folder** alongside the schema change in the same PR.

## Pointing at the right database

- **Local dev**: `DATABASE_URL` points at the local Postgres (docker-compose or local install).
- **Tests**: integration tests spin up an ephemeral Postgres (Testcontainers) and run
  `migrate deploy` against it — do not run `migrate dev` in tests.
- **CI/prod**: `DATABASE_URL` comes from Secrets Manager; only `migrate deploy` runs.

## Typical dev session

```bash
cd apps/backend
# edit prisma/schema.prisma ...
yarn prisma migrate dev --name add_artifact_relationships
# verify
yarn prisma migrate status
# if dev data got messy:
yarn prisma migrate reset && yarn prisma db seed
```

## Do NOT

- Do not run `migrate reset` against anything but a throwaway dev/test DB (it drops data).
- Do not hand-apply SQL out of band — go through a migration so history stays consistent.
- Do not bundle an unrelated destructive change into an additive migration.
