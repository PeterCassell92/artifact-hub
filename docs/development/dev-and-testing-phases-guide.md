# Development & Testing Phases

*Status: dev process. Related: [`../architecture/05-mcp-server-design.md`](../architecture/05-mcp-server-design.md)
(MCP surface + auth), [`../architecture/09-testing-strategy.md`](../architecture/09-testing-strategy.md)
(test layers), [`email-catcher.md`](email-catcher.md) (dev email), [`deploy-runbook.md`](deploy-runbook.md)
(deploy).*

How we run the stack locally and the order in which we validate it — from automated tests, through
manual MCP testing in **Claude Code**, to a final **Claude Desktop** pass against a deployed server.

---

## 1. Local dev environment

**One command brings up all backing services; the app processes run natively on the host** (for
fast reload + normal debugging). Nothing runs the backend or frontend inside Docker.

```bash
docker compose up -d      # Postgres + MailCatcher + MinIO (+ one-shot bucket create)
```

| Service | Container | Host port(s) | Purpose |
|---------|-----------|--------------|---------|
| Postgres | `postgres` | **5440** → 5432 | `DATABASE_URL`; port 5440 so it won't clash with a local 5432 (pgAdmin/psql connect to `localhost:5440`) |
| MailCatcher | `mailcatcher` | 1025 (SMTP), 1080 (web) | catches backend-sent invite/notification email — read at http://localhost:1080 |
| MinIO | `minio` | 9000 (S3 API), 9001 (console) | local S3-compatible object store; the dev stand-in for **Tigris** (prod). Console at http://localhost:9001 |
| MinIO bucket init | `createbuckets` | — | one-shot: creates `artifact-hub-dev` then exits 0 |

Then run the app processes yourself (**not** in Docker):

```bash
yarn workspace backend dev      # terminal 1 — API (/api/*) + MCP (/mcp) on :3081
yarn workspace frontend dev     # terminal 2 — React SPA (Vite) on :5173
```

**Local ports — where to point your browser / clients:**

| Process | URL | Notes |
|---------|-----|-------|
| **Frontend (SPA)** | **http://localhost:5173** | ← **open this in the browser.** Vite dev server, port pinned in [`apps/frontend/vite.config.ts`](../../apps/frontend/vite.config.ts) |
| **Backend API** | http://localhost:**3081**/api | the SPA calls this via `VITE_API_BASE_URL`; not a page to browse |
| **Backend MCP** | http://localhost:**3081**/mcp | MCP client endpoint (see §3) |

> Backend is on **3081** (not the usual 3000) to avoid clashing with other local apps — set by
> `PORT` in `apps/backend/.env` and defaulted in [`apps/backend/src/env.ts`](../../apps/backend/src/env.ts).
> The frontend's `VITE_API_BASE_URL` already points at `:3081`; if you change one, change the other.

> **Auth0 magic-link email is not caught by MailCatcher** — it's sent by Auth0's passwordless
> connection, so read it from the Auth0 dev tenant's log (see [`email-catcher.md`](email-catcher.md)).
> MailCatcher only catches email **our backend** sends (invitations/notifications).

Env: copy `.env.example` → `.env` at the **root** (set `POSTGRES_PASSWORD`) and
`apps/backend/.env.example` → `apps/backend/.env`. The MinIO credentials/bucket in the root `.env`
mirror the backend's `AWS_*` + `BUCKET_NAME`; defaults already align.

---

## 2. Testing phases

The phases run in increasing order of realism. Earlier phases are fast/automated and gate CI;
later phases are manual and validate the parts that only a real MCP client exercises (base64
framing, mimeType, host-mediated download).

### Phase 1 — Automated tests (CI gate, run continuously)

Per [`09`](../architecture/09-testing-strategy.md). No MCP client involved.

- **Core unit** — authz/policy/invite logic, no I/O (largest suite).
- **API integration** — supertest + **Testcontainers Postgres**.
- **MCP layered** — MCP TS SDK **in-memory** client/transport against each tool/resource/prompt
  handler, plus **HTTP black-box** tests hitting `/mcp` with a real token (assert JSON-RPC
  envelopes; assert files come back as **Resources**, never tool results).

`yarn lint && yarn typecheck && yarn test` — the CI gate on every PR.

### Phase 2 — Manual MCP testing with **Claude Code** (local backend) ← *near-term / primary*

Drive the running local backend's `/mcp` from a **Claude Code** MCP client (see §3 for the client
config). This is the day-to-day manual loop while building the MCP surface: publish → list →
`get_artifact` → read `artifact://<id>` resource → comment → share → `set_access_policy` (revoke),
watching `AccessEvent`s land and revocation take effect on the next read.

### Phase 3 — Exploratory checks with **MCP Inspector**

Use MCP Inspector for ad-hoc protocol poking (list tools/resources/prompts, inspect raw JSON-RPC,
try malformed args) when a behaviour is easier to see at the wire level than through a chat client.

### Phase 4 — Final validation: **Claude Desktop on Windows**, against a **deployed** server

The last phase moves to a **Windows machine running Claude Desktop**, ideally pointed at an
**already-deployed, publicly reachable** `/mcp` (Fly) rather than localhost. This is where we
confirm the things only a real desktop host surfaces (per [`05` §3](../architecture/05-mcp-server-design.md)):

- **base64 / embedded-resource framing** and correct **`mimeType`** end-to-end;
- **magic bytes** intact after round-trip (`%PDF`, PNG signature, etc.);
- **host-mediated download** (human clicks *save*; no silent agent-to-disk);
- the full **OAuth/DCR + magic-link** browser sign-in against the deployed resource server.

Reaching this phase depends on the deploy being live — see [`deploy-runbook.md`](deploy-runbook.md).

---

## 3. Client MCP config — connecting **our** Claude Code / Claude Desktop to the artifact-hub MCP server

> **Not to be confused with the repo's root [`.mcp.json`](../../.mcp.json).** That file configures
> the MCP servers **this project's** Claude Code loads as dev tooling (currently just the GitHub
> server). What follows is a **separate, client-side** config that points *your* MCP client at the
> artifact-hub `/mcp` server we build — the same shape for a **local** backend and for the
> **deployed public** URL, differing only in the `url`.

**Status: planned.** The artifact-hub MCP server is pre-implementation, so we don't commit a
working client config yet. The intended shape (Streamable HTTP) is:

```jsonc
{
  "mcpServers": {
    "artifact-hub-local": {
      "type": "http",
      "url": "http://localhost:3081/mcp"
    },
    "artifact-hub": {
      "type": "http",
      "url": "https://<app>.fly.dev/mcp"      // deployed public URL (Phase 4)
    }
  }
}
```

For Claude Code you can equivalently run `claude mcp add --transport http artifact-hub-local http://localhost:3081/mcp`.

**Authentication — decided (two tracks).** `/mcp` is an OAuth **Resource Server**: every request
must carry a **bearer token whose `aud` = the MCP audience (R2)**, resolving to an **active** local
user (R1/R4) ([`05` §2](../architecture/05-mcp-server-design.md),
[`02` §1.1](../architecture/02-auth-identity-and-admin.md)). We satisfy that two ways depending on
realism:

1. **Local / automated / manual-iteration (Phases 1–3) — a locally-minted audience-bound token.**
   We do **not** drive the interactive OAuth/DCR browser flow for every test. Instead we **hand the
   client a valid audience-bound token**, exactly mirroring how the API integration tests stub Auth0
   with **signed test JWTs** ([`09` §3–§4](../architecture/09-testing-strategy.md)). The RS
   validation is shared middleware parameterised by the expected audience ([`02` §1](../architecture/02-auth-identity-and-admin.md)),
   so a token minted with the **MCP audience** and a `sub` for a seeded active user flows through the
   **real** signature/issuer/audience/`status=active` checks (R1/R2/R4) — only the *signer* is a
   dev/test key trusted **in dev/test only**, never in prod.
   - **Automated (Jest):** the shared test-token helper mints the JWT in-process.
   - **Manual (you, at the REPL of a chat client):** mint one via the **dev-only token endpoint** and
     paste it into your MCP client config's `Authorization` header — this is what the
     [Bruno collection](bruno-mcp-token.md) automates.
2. **Deployed final validation (Phase 4) — the real interactive flow.** Against the deployed Fly
   `/mcp`, **Claude Desktop** completes the genuine **OAuth/DCR + passwordless magic-link** browser
   sign-in (R5). No shortcut token here — Phase 4 exists precisely to prove that real flow end-to-end.
   The dev token endpoint is **not** deployed to prod.

So the client config above is sufficient for Phases 2–3 **once you add the minted bearer token**;
Phase 4 relies on the client's interactive sign-in instead. See [`bruno-mcp-token.md`](bruno-mcp-token.md)
for the mint-and-copy workflow.
