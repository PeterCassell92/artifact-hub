# Artifact Hub

A hosted platform to publish and share AI-generated artifacts (PDF/HTML/images/docx/mmd/md) with
managed, revocable access control — usable by humans (web SPA) and AI agents (MCP server) alike.

**Live:** [artifact-hub.netlify.app](https://artifact-hub.netlify.app/) (invite-only) ·
**MCP setup guide:** [artifact-hub.netlify.app/get-started](https://artifact-hub.netlify.app/get-started) ·
**Write-up:** [WRITEUP.md](WRITEUP.md)

## What it does

- Publish an artifact from the SPA or straight from an agent (`publish_artifact` over MCP) — both
  paths converge on the same domain logic.
- Share it with everyone, a specific group, or named individuals, with an expiry — and revoke
  access instantly at any time.
- Every view/download is authenticated and audited — no anonymous access, no bearer-token share
  links.
- Agents can list, comment on, link, and reason over artifacts and their relationships via MCP
  tools, resources, and prompts — without an LLM ever running on our backend.

## Stack

Express + TypeScript + Prisma (Postgres) backend serving both `/api` and `/mcp`, React + Redux
Toolkit + Tailwind SPA, shared `packages/contracts` (zod), Auth0 (passwordless magic-link auth),
Tigris (S3-compatible storage), Resend (email). Backend on Fly.io, frontend on Netlify. Full
architecture: [docs/architecture/01-overview.md](docs/architecture/01-overview.md).

## Repo layout

```
apps/backend      Express + MCP + Prisma + core domain
apps/frontend     React SPA
packages/contracts  shared zod schemas + TS types
docs/             architecture · models · frontend · user-journeys · development
```

## Getting started

```bash
corepack enable                               # activates the pinned Yarn (Volta pins Node)
docker compose up -d                          # Postgres + MailCatcher
yarn install
yarn workspace contracts build
yarn workspace backend prisma:generate
yarn workspace backend db:migrate
yarn workspace backend db:seed                # seeds groups + INITIAL_ADMIN_EMAILS
yarn workspace backend dev                    # terminal 1: backend (api + mcp)
yarn workspace frontend dev                   # terminal 2: SPA
```

See [CLAUDE.md](CLAUDE.md) for the full command reference and
[docs/development/dev-and-testing-phases-guide.md](docs/development/dev-and-testing-phases-guide.md)
for local stack + test phases.
