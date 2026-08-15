# Bruno collection — mint an MCP bearer token for manual testing

*Status: plan / pre-implementation. Related:
[`dev-and-testing-phases-guide.md`](dev-and-testing-phases-guide.md) (testing phases + client MCP
config), [`../architecture/02-auth-identity-and-admin.md`](../architecture/02-auth-identity-and-admin.md)
§1/§1.1 (RS validation, R1–R5), [`../architecture/09-testing-strategy.md`](../architecture/09-testing-strategy.md)
§4 (MCP HTTP tests).*

A small, git-committed **[Bruno](https://www.usebruno.com/)** collection whose job is one thing:
**mint a valid audience-bound MCP token against the local backend, so you can paste it into an MCP
client (Claude Code / Claude Desktop / MCP Inspector) or fire `/mcp` calls straight from Bruno.**
This is the manual half of the auth decision in
[`dev-and-testing-phases-guide.md` §3](dev-and-testing-phases-guide.md) — it does **not** replace
the Phase-4 interactive OAuth flow.

Bruno is chosen over Postman because collections are **plain-text `.bru` files** that live in the
repo and diff cleanly in git (no cloud account, no binary export) — consistent with our
[mainstream-tooling preference](../../CLAUDE.md).

---

## 1. What has to exist first — the dev token endpoint

The collection is a thin client over one new **dev-only** backend route. Spec:

- **Route:** `POST /dev/mcp-token` (mounted on the same Express app, **outside** `/mcp` and
  `/api/*`).
- **Body:** `{ "email": "alice@dev.local" }` — must resolve to a **seeded, `status=active`**
  `users` row (see `db:seed` / `INITIAL_ADMIN_EMAILS`).
- **Response:**
  ```json
  {
    "access_token": "<jwt>",
    "token_type": "Bearer",
    "expires_in": 3600,
    "aud": "https://mcp.artifact-hub.example"
  }
  ```
- **What it signs:** a JWT with `iss` (the dev issuer), **`aud` = the MCP resource**, `sub` = that
  user's `idp_sub`, and a short `exp` — using the **dev/test signing key**. It reuses the **same
  test-token helper** the Jest suites use ([`09` §3–§4](../architecture/09-testing-strategy.md)); the
  endpoint is just an HTTP wrapper so a human/Bruno can obtain one too.
- **Why this is safe & faithful:** the minted token then flows through the **unmodified RS
  middleware** — JWKS/issuer/**audience**/expiry, resolve `sub` → active `users` row (R1/R2/R4). We
  are not bypassing authz; we are only swapping the *signer* from Auth0 to a dev key that the
  validator trusts **only in dev/test**.

### Non-negotiable guardrails (put these in the route + its tests)

- **Never in production.** The route module is **not imported/mounted when `NODE_ENV=production`**
  (belt-and-braces: also `return 404` if somehow reached). The validator's acceptance of the dev
  signing key is likewise gated to dev/test — prod trusts **only** Auth0 JWKS.
- **Shared dev secret.** Require a header (e.g. `X-Dev-Token: <DEV_MINT_SECRET>` from
  `apps/backend/.env`) so the endpoint isn't wide open on a shared dev host.
- **Active users only.** Refuse emails with no active `users` row — mirrors R1/R4 so the token you
  get behaves exactly like a real one.
- **Short-lived.** Small `expires_in`; re-mint rather than long TTLs.

> If we later want a *real* Auth0 token for deeper realism, note it can't be fully scripted in
> Bruno: our login is **passwordless magic-link + PKCE in a browser**, and Auth0 **client-credentials
> (M2M)** tokens carry no user `sub` that resolves to a `users` row (fails R1). That's why the
> dev-mint endpoint is the right tool for Phases 2–3 and the real interactive flow is reserved for
> Phase 4.

---

## 2. Collection layout

Commit under `tools/bruno/artifact-hub-mcp/` (create the `tools/` dir; it's dev tooling, not app
code):

```
tools/bruno/artifact-hub-mcp/
  bruno.json                      # collection manifest (name, version, ignore)
  environments/
    local.bru                     # baseUrl, devUser, devMintSecret, (runtime) mcpToken
    deployed.bru                  # baseUrl only — token N/A (Phase 4 uses interactive OAuth)
  Mint MCP Token.bru              # POST /dev/mcp-token  → stashes access_token into env
  MCP/
    01 Initialize.bru             # JSON-RPC initialize
    02 List Tools.bru             # tools/list
    03 List Shared With Me.bru    # tools/call list_shared_with_me { sinceHours: 24 }
    04 Read Artifact Resource.bru # resources/read artifact://<id>
```

### `environments/local.bru`

```
vars {
  baseUrl: http://localhost:3081
  devUser: alice@dev.local
  devMintSecret: {{process.env.DEV_MINT_SECRET}}
  mcpToken:                      // filled at runtime by "Mint MCP Token"
}
```

Keep the real secret in `.env` / your shell, referenced via `{{process.env.DEV_MINT_SECRET}}` — do
**not** hardcode it in the committed `.bru`.

### `Mint MCP Token.bru`

```
post {
  url: {{baseUrl}}/dev/mcp-token
  body: json
}
headers {
  X-Dev-Token: {{devMintSecret}}
}
body:json {
  { "email": "{{devUser}}" }
}
script:post-response {
  // auto-stash so the MCP/* requests below can use it without copy-paste
  bru.setEnvVar("mcpToken", res.body.access_token);
}
assert {
  res.status: eq 200
  res.body.aud: eq https://mcp.artifact-hub.example
}
```

**The copy-into-your-client step:** after running this request, the token is in the response body
(and in the `mcpToken` env var). Paste `Bearer <access_token>` into your MCP client:

- **Claude Code:** `claude mcp add --transport http artifact-hub-local http://localhost:3081/mcp --header "Authorization: Bearer <token>"` (or add the header to the client config from
  [`dev-and-testing-phases-guide.md` §3](dev-and-testing-phases-guide.md)).
- **MCP Inspector:** set the Authorization header in the connection pane.
- **Claude Desktop (local):** add the `Authorization` header to the server entry.

### `MCP/*.bru` (optional bonus — drive `/mcp` from Bruno itself)

Each uses `Authorization: Bearer {{mcpToken}}` and posts a JSON-RPC envelope to `{{baseUrl}}/mcp`,
e.g. `03 List Shared With Me.bru`:

```
post {
  url: {{baseUrl}}/mcp
  body: json
}
headers {
  Authorization: Bearer {{mcpToken}}
  Accept: application/json, text/event-stream
}
body:json {
  {
    "jsonrpc": "2.0", "id": 1, "method": "tools/call",
    "params": { "name": "list_shared_with_me", "arguments": { "sinceHours": 24 } }
  }
}
```

This gives a lightweight, scriptable alternative to MCP Inspector for the common calls — handy in
Phase 3 for poking raw JSON-RPC without a chat client.

---

## 3. Usage workflow

1. Bring up the stack (`docker compose up -d`; `yarn workspace backend dev`) and seed a dev user
   (`db:seed`).
2. Export `DEV_MINT_SECRET` (matches `apps/backend/.env`).
3. In Bruno, select the **local** environment → run **Mint MCP Token**.
4. Either **copy the `access_token`** into your MCP client's `Authorization` header (primary goal),
   **or** run the **MCP/** requests directly in Bruno.
5. Re-mint when it expires. To test **revocation/deactivation** (R4), disable the user or narrow a
   policy, then re-run an **MCP/** call and watch it flip to denied on the next request.

---

## 4. Build checklist (when we implement)

- [ ] Backend: shared **test-token helper** signs API- and MCP-audience JWTs with the dev/test key.
- [ ] Backend: `POST /dev/mcp-token` route — env-gated (not mounted in prod), `X-Dev-Token`
      guard, active-user check, reuses the helper; unit + integration tests incl. a test asserting
      it is **absent in prod**.
- [ ] Backend: RS validator trusts the dev signing key **only** in dev/test.
- [ ] `tools/bruno/artifact-hub-mcp/` collection + `local`/`deployed` environments as above.
- [ ] `.env.example`: add `DEV_MINT_SECRET`.
- [ ] Cross-link this doc from the deploy runbook's "not for prod" list.
