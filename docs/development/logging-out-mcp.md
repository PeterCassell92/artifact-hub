# Logging out of an MCP session fully (switching Auth0 accounts)

*Related: [`Auth0configuration.md`](Auth0configuration.md) (DCR + OAuth setup),
[`../architecture/02-auth-identity-and-admin.md`](../architecture/02-auth-identity-and-admin.md)
(auth & identity design).*

## The problem

When you clear authentication in an MCP client (e.g. Claude Code's `/mcp` → disconnect, or
deleting its stored credentials) and then reconnect, Auth0 **remembers the previous account** and
skips the login screen — you land straight on the "Authorize App" consent page as the old user,
with no way to enter a different email.

That's because clearing auth on the client only deletes the **local tokens**. The browser still
holds a live **Auth0 single-sign-on session cookie** for the tenant domain. When the OAuth flow
reopens the browser, Auth0 sees the existing session and silently reuses it. Clicking **Decline**
on the consent screen does *not* end that session either.

Two independent sessions are in play; both must be cleared to switch accounts:

| Session | Where it lives | How it's cleared |
|---------|----------------|------------------|
| MCP client tokens (access/refresh) | The MCP client (e.g. Claude Code) | Client-side disconnect / clear auth |
| Auth0 SSO session | Browser cookie on the tenant domain | The `/v2/logout` endpoint (below) |

## The fix — hit the tenant's logout endpoint

In the **same browser** the OAuth flow opens, visit the tenant's logout URL:

**Dev tenant (`ArtifactHub-Dev`):**

```
https://dev-vqh6layk30s67fwy.us.auth0.com/v2/logout
```

**Prod tenant (`ArtifactHub-Prod`):** same path on the prod tenant's domain:

```
https://<prod-tenant-domain>/v2/logout
```

You'll get a plain `OK` response — that's success. The Auth0 session cookie is now gone.

Then restart the auth flow in the MCP client (in Claude Code: `/mcp` → select the server →
authenticate). Auth0 no longer has a session, so it shows the login screen and you can enter the
other account's email.

### Full account-switch recipe

1. In the MCP client, clear/disconnect the server's authentication (Claude Code: `/mcp` →
   choose the server → **Clear authentication**).
2. In the browser, visit `https://dev-vqh6layk30s67fwy.us.auth0.com/v2/logout`.
3. In the MCP client, reconnect/authenticate — you get a fresh login prompt.
4. Enter the new account's email and complete the passwordless flow.

## Notes

- **`?federated`** — appending `?federated` to the logout URL also signs you out of an upstream
  identity provider (e.g. a Google social connection). Not needed for our passwordless email
  connection; the bare URL is enough.
- **Incognito alternative** — running the auth flow in a private/incognito window sidesteps the
  problem entirely (no cookie → always a fresh login). Handy when testing several accounts side
  by side.
- **Cookie deletion alternative** — deleting the browser's cookies for the tenant domain
  (`dev-vqh6layk30s67fwy.us.auth0.com`) is equivalent to hitting `/v2/logout`.
- **Why not force re-login server-side?** Auth0 supports `prompt=login` on the authorization
  request, which would always re-prompt. But in the MCP Dynamic Client Registration flow the
  *client* (Claude Code) constructs the authorization request, so we can't inject that parameter
  cleanly. The logout URL is the practical answer.
