# 09 — Testing Strategy

*Status: design. Related: [03](03-authorization-and-access-control.md),
[05](05-mcp-server-design.md), [06](06-api-design.md), user-journeys/.*

A layered pyramid split across the two apps. On the **backend**: many fast core unit tests,
focused API integration tests, and the layered MCP tests. On the **frontend**: React component
unit tests. Plus manual MCP exploration. **End-to-end (Playwright) is out of scope for v1.**

Test runner: **Jest** across the workspace (backend + frontend). Package manager: **yarn**
(workspaces).

---

## 1. Layers

```
   Backend (apps/backend)                     Frontend (apps/frontend)
   ┌───────────────────────────┐              ┌───────────────────────────┐
   │  MCP tests (layered)       │              │  React component unit      │
   │  in-memory SDK + HTTP      │              │  tests (*.test.tsx)        │
   ├───────────────────────────┤              │  Jest + React Testing Lib  │
   │  API integration (Jest)    │              └───────────────────────────┘
   │  Express + Testcontainers  │
   ├───────────────────────────┤
   │  Core unit (Jest) — many   │
   │  authz, policy, invites    │
   └───────────────────────────┘
   Manual: MCP Inspector + Claude Desktop
```

Out of scope for v1: browser end-to-end (Playwright). Revisit post-v1 if needed.

---

## 2. Core domain unit tests — backend (the largest layer)

Pure functions in `core`, no I/O, exhaustive:

- **`canView` / `canComment` / `canManagePolicy`** — every row of the `03` truth table: owner
  short-circuit (incl. after expiry), `public_authenticated`, `specific_users` in/out,
  `user_groups` intersection empty/non-empty, expired vs not.
- **Policy expiry** — bucket → `expires_at` computation for 24h/7d/30d/never; boundary at
  `now == expires_at`.
- **Revocation** — narrowing audience / earlier expiry flips a previously-allowed non-owner to
  denied; owner still allowed.
- **Invitation lifecycle** — token hashing, single-use, expiry, role/group assignment on accept.
- **Outbox/idempotency** — retry does not double-send; idempotency key dedupes.

## 3. API integration tests — backend (Jest + supertest + Testcontainers)

- Spin up an **ephemeral Postgres** (Testcontainers), run `prisma migrate deploy`, seed.
- Drive Express routes with **supertest** (see §6); stub Auth0 token validation with signed test
  JWTs; stub SES/Auth0 Management API at the boundary.
- Cover: publish → finalize → view/download authz, comment read/write permission, policy update
  (revocation) killing a share-link redemption, admin invite creating an outbox row, invitation
  accept provisioning user + immutable groups, `sharedWithMe&sinceHours=24` results.

## 4. MCP tests — backend (layered — the confirmed approach)

- **In-memory (unit-ish)**: use the MCP TS SDK's **in-memory client/transport** to call each
  tool/resource/prompt handler directly. Assert:
  - tool results are **metadata-only** (no raw bytes),
  - `list_shared_with_me` returns all rows but renders the **first 10 as a markdown table** with
    id/filetype/publishingUserName/publicationDate,
  - `artifact://<id>` resource returns correct blob + `mimeType`,
  - `summarise_artifact_reviews` prompt injects the artifact's comments and asks for a summary
    (no server-side model call),
  - `set_access_policy` enforces owner-only.
- **HTTP black-box**: hit the running **`/mcp`** endpoint over Streamable HTTP with a real token;
  assert JSON-RPC envelopes and that files come back as **Resources**, never tool results.

## 5. React component unit tests — frontend (`*.test.tsx`)

- **Jest + React Testing Library** (with `jsdom`), testing components in isolation.
- Render wrapped in the **Redux `<Provider>`** (a test store) + router; query by role/label/text.
- **Notifications/confirmations are asserted as in-DOM nodes** (`role="alert"`/`status"`/`dialog"`).
  Tests must **not** rely on `window.alert/confirm/prompt` or toast timing — those are banned in the
  UI (see [`../development/frontend-patterns.md`](../development/frontend-patterns.md) and the
  `frontend-component-testing` skill), which is exactly what makes these tests deterministic.
- Naming: co-locate as `<Component>.test.tsx` next to the component.
- Cover the high-value UI units, mocking the API layer (`packages/contracts` types keep the mocks
  honest):
  - **Artifact detail** — renders viewer, download button gated on `canView`, comments list shows
    body + author name + date.
  - **Comment form** — submit adds a comment; disabled/hidden when the user lacks view permission.
  - **Publish/policy form** — audience selector (public / specific users / groups) + expiry buckets
    (24h/7d/30d/never) produce the expected request payload.
  - **Admin users page** — invite form validates email + requires a group + role; list renders
    status (invited/active).
  - **Auth/guard components** — admin-only routes hidden from members.
- These are unit-level (rendered component + interactions), **not** browser E2E.

## 6. Why supertest for API integration tests

**What it is.** `supertest` is a small, widely-used Node.js library for testing HTTP servers. You
hand it your **Express app instance** (not a URL); it boots the app on an ephemeral port (or
in-memory), issues real HTTP requests, and gives a fluent assertion API over the response:

```ts
import request from "supertest";
import { app } from "../src/app";

it("denies view when not in audience", async () => {
  await request(app)
    .get(`/api/artifacts/${id}`)
    .set("Authorization", `Bearer ${tokenForOutsider}`)
    .expect(403);
});
```

**Why it fits here:**
- **Tests the real Express stack** — routing, middleware, zod validation, auth guard, error
  contract — exactly the layers our bugs would hide in, without mocking the framework.
- **No real network / no fixed port** — it binds the app directly, so tests are fast and can run
  in parallel in CI (Testcontainers provides the DB; supertest provides the HTTP driver).
- **First-class Jest integration** — returns promises, works with `async/await`, plays with our
  JWT/SES/Auth0 boundary stubs.
- **Mainstream + Express-native** — it is the de-facto standard for Express integration testing
  (consistent with our preference for well-known tooling). No niche alternative offers a decisive
  advantage for this scenario.

Scope note: supertest exercises `/api/*`. The MCP `/mcp` endpoint is covered by the SDK in-memory
client and the HTTP black-box tests in §4, which understand the JSON-RPC/Streamable-HTTP envelope
that supertest alone would not assert on.

---

## 7. Yarn commands (how we run the tests)

Root scripts fan out across workspaces; per-app scripts target one workspace. See `CLAUDE.md`
for the full script catalogue.

| Goal | Command |
|------|---------|
| Install everything | `yarn install` |
| Run **all** tests (both apps) | `yarn test` |
| Backend: all tests | `yarn workspace backend test` |
| Backend: core unit only | `yarn workspace backend test:unit` |
| Backend: API integration (needs Docker for Testcontainers) | `yarn workspace backend test:integration` |
| Backend: MCP tests (in-memory + HTTP) | `yarn workspace backend test:mcp` |
| Frontend: React component tests | `yarn workspace frontend test` |
| Watch mode (dev loop) | `yarn workspace <app> test --watch` |
| Coverage (enforced on `core`) | `yarn workspace backend test:cov` |
| Lint + typecheck | `yarn lint` / `yarn typecheck` |

CI (`ci.yml`, see `08`) runs `yarn install --immutable` then `yarn lint`, `yarn typecheck`,
`yarn test` on every PR.

---

## 8. BDD scenario → test-layer mapping

| `.feature` scenario | Primary automated layer |
|---------------------|-------------------------|
| publisher-publish-with-policy | MCP in-memory (`publish_artifact`) + core unit (policy) |
| publisher-revoke-and-my-artifacts | API integration (policy update + My Artifacts) + core unit |
| reviewer-access-via-ui | API integration (authz/download/comments) + React component (detail/comment) |
| reviewer-access-via-mcp | MCP in-memory + HTTP (`list_shared_with_me`, resource read) |
| admin-invite-user | API integration (invite + accept + immutable groups) + React component (admin page) |
| access-denied-after-expiry | core unit + API integration (redeem denied) |

Gherkin step definitions are future implementation work; the `.feature` files are the executable
spec target. Coverage thresholds are enforced on the `core` package (authz logic is the
highest-risk surface).
