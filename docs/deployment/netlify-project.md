# Production URLs — quick reference

*Status: dev process. Related: [`../development/deploy-runbook.md`](../development/deploy-runbook.md),
[`flyio-costs.md`](flyio-costs.md).*

Using Fly/Netlify's free default domains for this deployment (no custom domain) — see the domain
decision in the deploy runbook walkthrough.

## Frontend (Netlify SPA)

| | |
|---|---|
| Public URL | https://artifact-hub.netlify.app |
| Admin dashboard | https://app.netlify.com/projects/artifact-hub |
| Project ID | `91e5b62d-bcf7-4966-9bdd-d1d01549c8ef` |

## Backend (Fly.io — `/api/*` + `/mcp`)

| | |
|---|---|
| Public URL | https://artifact-hub-backend.fly.dev |
| Admin dashboard | https://fly.io/apps/artifact-hub-backend |
| Health check | https://artifact-hub-backend.fly.dev/healthz |
| Readiness check | https://artifact-hub-backend.fly.dev/readyz |

## Infra

| | |
|---|---|
| Fly Managed Postgres cluster | `artifact-hub-db` (`kyzl60xzqzlrpj9g`, region `lhr`, plan `basic`) |
| Tigris bucket | `artifact-hub-artifacts` (attached to the backend app) |

## Auth0

Prod tenant: `ArtifactHub-Prod` (separate from `ArtifactHub-Dev`). Callback/origin URLs on the SPA
application point at the Netlify URL above; the two API audiences are built from the Fly backend
URL (`.../api`, `.../mcp`).
