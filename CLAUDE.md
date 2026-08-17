# CLAUDE.md — Artifact Hub

Guidance for working in this repo. Read the design docs in [`docs/architecture/`](docs/architecture/)
before making structural changes — [`01-overview.md`](docs/architecture/01-overview.md) is the entry
point and holds the decision log.

> **Status:** design-complete, pre-implementation. The layout and scripts below describe the
> intended structure; create files to match it as implementation proceeds.

## What this is

A hosted platform to publish and share AI-generated artifacts (PDF/HTML/images/docx/mmd/md) with
managed, revocable access control, usable by humans (web SPA) and AI agents (MCP server). One
backend (Express) serves both `/api/*` and `/mcp` over a shared `core` domain layer.

## Core principles (don't violate these)

- **No anonymous access** — every viewer is authenticated. See [03](docs/architecture/03-authorization-and-access-control.md).
- **Passwordless auth (magic link)** — all users incl. admins sign in via emailed magic link; no
  passwords, no password reset. See [02](docs/architecture/02-auth-identity-and-admin.md).
- **Publishing is available two ways** — via an agent (`publish_artifact`, MCP) or via the SPA's
  Dashboard ("Publish New Artifact"). Both paths converge on the same `core` create+finalize
  logic; the UI path only ever collects a file — it always creates a private, owner-only,
  never-expiring artifact (title = filename) that the owner then configures via the existing
  access-policy editor. See [frontend/](docs/frontend/).
- **One owner-controlled access policy per artifact**, re-evaluated on every request → revocation
  is instant; **share links are pure locators**, never bearer tokens of access.
- **The backend makes no LLM calls** — all logic is deterministic. Review summaries are an MCP
  **Prompt** run by the client's model.
- **Files never come back as MCP tool results** — agent file delivery is via the
  `artifact://<id>` **Resource**; presigned object-store URLs are confined to the browser/download path.
- **Group membership is admin-assigned and immutable to the user** — there is no self-service
  group-change route.
- **Every artifact access is audited** — an `AccessEvent` is written on view/download via the UI,
  a share link, or an MCP agent (allowed and denied). See [models/access-event.md](docs/models/access-event.md).

## Tech stack

- **Toolchain:** pinned with **Volta** (the `volta` field in **root** `package.json`), **not**
  `.nvmrc`. It pins **both `node` and `yarn`**, so `cd`-ing into the repo auto-switches everyone to
  the same Node **and** Yarn — no manual `nvm use` / `corepack` locally. Pin only at the root; Volta
  resolves the toolchain from the nearest package.json up the tree, so the workspace packages
  (`apps/*`, `packages/*`) don't need their own `volta` field. Bump via `volta pin node@<v>` /
  `volta pin yarn@<v>`. The `packageManager` field stays in sync as the corepack fallback for
  environments without Volta (e.g. CI). Do not add an `.nvmrc`.
- **Package manager:** yarn (workspaces). **Monorepo.** Both frontend and backend use
  **`nodeLinker: node-modules`** (set in root `.yarnrc.yml`), **not** Plug'n'Play (PnP) — so a
  real `node_modules/` tree is installed, which keeps Prisma, Jest/Testcontainers, bundlers, and
  editor tooling working without PnP loader shims. `node_modules/` is git-ignored (see `.gitignore`).
- **Backend:** Node + TypeScript, **Express**, zod validation, **Prisma** (Postgres), MCP TS SDK
  (Streamable HTTP).
- **Frontend:** React SPA (admin + gallery + artifact detail) — **Redux Toolkit** for state,
  **Tailwind** for styling, modular well-tested components. Professional, restrained visuals (no
  over-design). See [development/frontend-patterns.md](docs/development/frontend-patterns.md).
- **Shared:** `packages/contracts` — zod schemas + TS types for the API/MCP contract, imported by
  both apps.
- **Infra:** **CLI-deployed, no IaC/Terraform.** Frontend on **Netlify**; backend + `/mcp` on
  **Fly.io** (machines + `fly-proxy`); **Fly Managed Postgres**; **Tigris** (S3-compatible object
  store); **Resend** (SMTP invitation email); **`fly secrets`** for runtime secrets; **Auth0** IdP
  (**one tenant per environment: `ArtifactHub-Dev` and `ArtifactHub-Prod`** — both OAuth roles share
  the environment's tenant; see [02](docs/architecture/02-auth-identity-and-admin.md) §1). Committed
  `fly.toml` + `netlify.toml` + the
  [deploy runbook](docs/development/deploy-runbook.md) are the source of truth. See
  [07](docs/architecture/07-infrastructure-and-iac.md).
- **Tests:** Jest everywhere; supertest + Testcontainers (API); MCP SDK in-memory + HTTP (MCP);
  React Testing Library (`*.test.tsx`). **No E2E/Playwright in v1.** See [09](docs/architecture/09-testing-strategy.md).

## Repo layout

```
apps/backend      Express + MCP + Prisma + core domain   (own package.json)
apps/frontend     React SPA                               (own package.json)
packages/contracts  shared zod schemas + TS types         (own package.json)
docs/             architecture/ · models/ · frontend/ · user-journeys/ · development/
fly.toml          Fly app config (backend + /mcp)
netlify.toml      Netlify build config (SPA)
package.json      root: private, workspaces + fan-out scripts
```

Docs map: [architecture/](docs/architecture/) (decisions, entry point `01`), [models/](docs/models/)
(field-level domain models — schema source of truth), [frontend/](docs/frontend/) (UX, incl. the
Publish New Artifact flow), [user-journeys/](docs/user-journeys/) (BDD), [development/](docs/development/) (dev tooling +
[implementation-plan.md](docs/development/implementation-plan.md): **build order / handoff plan —
start here when implementing**; [dev-and-testing-phases-guide.md](docs/development/dev-and-testing-phases-guide.md): local stack,
test phases, MCP client config; [bruno-mcp-token.md](docs/development/bruno-mcp-token.md): Bruno
collection to mint an MCP bearer token for manual testing; [environment-prerequisites.md](docs/development/environment-prerequisites.md):
per-environment external services to set up; [Auth0configuration.md](docs/development/Auth0configuration.md):
Dynamic Client Registration + Resource Parameter Compatibility Profile setup for real MCP OAuth
logins; [logging-out-mcp.md](docs/development/logging-out-mcp.md): fully logging out of an MCP
OAuth session / switching Auth0 accounts via `/v2/logout`), [future-features/](docs/future-features/) (speculative
post-v1 ideas, e.g. [AI-features.md](docs/future-features/AI-features.md): server-side LLM inference
over the artifact corpus).

Each app/package has its **own `package.json`**. The **root `package.json`** declares
`workspaces: ["apps/*", "packages/*"]` and root fan-out scripts.

## Yarn scripts

### Root (fan out across all workspaces)
| Command | Does |
|---------|------|
| `yarn install` | Install all workspace deps |
| `yarn test` | Run all tests (backend + frontend) |
| `yarn lint` | Lint all workspaces |
| `yarn typecheck` | Typecheck all workspaces |
| `yarn build` | Build all workspaces |

### Target one workspace
Use `yarn workspace <name> <script>` where `<name>` is `backend`, `frontend`, or `contracts`.

### Backend (`yarn workspace backend <script>`)
| Command | Does |
|---------|------|
| `dev` | Run the backend locally (API + `/mcp`) with reload |
| `build` | Compile TypeScript |
| `test` | All backend tests |
| `test:unit` | Core domain unit tests (authz, policy, invites) — fast, no I/O |
| `test:integration` | API integration tests (supertest + **Testcontainers Postgres**; needs Docker) |
| `test:mcp` | MCP tests (SDK in-memory + HTTP black-box against `/mcp`) |
| `test:cov` | Tests with coverage (enforced on `core`) |
| `db:migrate` | `prisma migrate dev` (see the `prisma-migrate` skill) |
| `db:deploy` | `prisma migrate deploy` (CI/prod) |
| `db:reset` | `prisma migrate reset` (destroys dev DB) |
| `db:seed` | `prisma db seed` (initial groups + `INITIAL_ADMIN_EMAILS` admins, idempotent) |
| `db:studio` | Open Prisma Studio |

### Frontend (`yarn workspace frontend <script>`)
| Command | Does |
|---------|------|
| `dev` | Run the SPA dev server |
| `build` | Production build |
| `test` | React component unit tests (`*.test.tsx`) |
| `test --watch` | Watch mode for the dev loop |

### First-time setup / dev loop
```bash
corepack enable                               # activates the pinned Yarn (Volta pins Node)
docker compose up -d                          # Postgres + MailCatcher (email catcher)
yarn install
yarn workspace contracts build                # build the shared package once (apps import its dist)
yarn workspace backend prisma:generate        # generate the Prisma client
yarn workspace backend db:migrate             # create/apply the first migration (after editing schema.prisma)
yarn workspace backend db:seed                # seed groups + INITIAL_ADMIN_EMAILS
yarn workspace backend dev                    # terminal 1: backend (api + mcp)
yarn workspace frontend dev                   # terminal 2: SPA
yarn test                                     # before pushing
```
Rebuild `contracts` (`yarn workspace contracts build`) whenever you change its types — the apps
consume its compiled `dist`. The root `yarn build` already builds contracts first.

Emails in dev (invitations / notifications) are caught by **MailCatcher** — read them at
`http://localhost:1080`. See [development/email-catcher.md](docs/development/email-catcher.md).

## Migrations

Prisma. **Never edit an applied migration** — add a new one. Write migrations expand/contract so
rolling deploys stay safe. Full rules in the **`prisma-migrate`** skill and
[04](docs/architecture/04-data-model.md) §6.

## MCP surface

When adding/editing an MCP tool/resource/prompt, follow the **`mcp-tool-descriptions`** skill
(what / when / when-not / disambiguation / example) so agents pick the right tool. Surface is
defined in [05](docs/architecture/05-mcp-server-design.md).

## Frontend development patterns

React + **Redux Toolkit** + **Tailwind**, modular well-tested components. Follow the
**`frontend-patterns`** and **`frontend-component-testing`** skills; full detail in
[development/frontend-patterns.md](docs/development/frontend-patterns.md).

**Banned anti-patterns (they break testability):**
- ❌ **`window.alert` / `window.confirm` / `window.prompt`** — live outside the DOM, block the
  thread; RTL/E2E can't drive them.
- ❌ **Toasts / auto-dismissing popups** — timer-based dismissal races test assertions → flaky.

**Use instead:** state-driven, **in-DOM notifications** (a notifications slice + a
`NotificationRegion` with `role="alert"`/`role="status"`, dismissed by the user or a state change,
**never a timer**); **in-app modals** (`role="dialog"`) for confirmations; **inline** messages for
form feedback. This keeps every notification a queryable DOM node with no timing dependency.

## Testing expectations

- Backend: **core unit** (largest), **API integration** (supertest + Testcontainers), **MCP
  layered** (in-memory + HTTP).
- Frontend: **React component** unit tests (`*.test.tsx`, React Testing Library + jsdom).
- Manual MCP checks: **MCP Inspector** and **Claude Desktop** (verify base64/mimeType/magic bytes).
- CI runs `yarn lint`, `yarn typecheck`, `yarn test` on every PR.

## Conventions

- Route handlers call `core` authz functions (`canView`/`canComment`/`canManagePolicy`) — never
  re-implement access checks.
- Read role/group from the **database**, never trust token claims for authorization.
- Keep request/response types in `packages/contracts` so both apps type-check against one contract.
- When writing/editing a domain mutation, external call, or auth/authz decision, add structured
  `logger`/`req.log` calls (`requestId`, `userId`, `route`/`tool`, `status`, `latencyMs`; never
  tokens/file bytes/PII beyond `userId`/email) — see [10](docs/architecture/10-observability.md) §1.
