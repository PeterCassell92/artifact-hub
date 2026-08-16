# Auth0 configuration — Dynamic Client Registration + Resource Parameter Compatibility

*Status: dev process — done on `ArtifactHub-Dev` as of 2026-08-16. Related:
[`../architecture/02-auth-identity-and-admin.md`](../architecture/02-auth-identity-and-admin.md)
§1/§1.1 (the full MCP OAuth flow these unlock, R1–R5),
[`environment-prerequisites.md`](environment-prerequisites.md) §Auth0 tenant setup (the rest of the
tenant: SPA app, M2M app, the two APIs/audiences, the passwordless connection),
[`bruno-mcp-token.md`](bruno-mcp-token.md) (the dev/test shortcut that doesn't need any of this).*

Two **tenant-level** toggles Auth0 needs before an MCP client (Claude Desktop, Claude Code) can
complete a *real* OAuth login against `/mcp`, instead of the `/test/mcp-token` dev shortcut. Both
live in the same place and are easy to miss because they're **not** on the API's own settings page
(`Applications → APIs → <api>`) — they're tenant-wide.

## Where to find them

**`https://manage.auth0.com/dashboard/#/tenant/advanced`** — direct link into your tenant's
Advanced settings (there's no link to this page in the left sidebar; it's reached via the tenant
menu, not the Applications section). Both toggles are on this one page.

## 1. OIDC Dynamic Application Registration (DCR)

**What it is:** lets an MCP client self-register as an OAuth application at runtime
(`POST /oidc/register`, RFC 7591) instead of us pre-creating an "app" for every possible client in
the Auth0 dashboard. This is how Claude Desktop/Code get a `client_id` the first time they connect
to `/mcp` — see [`02` §1.1](../architecture/02-auth-identity-and-admin.md) step 5.

**Off by default** for every tenant. Toggle: **"OIDC Dynamic Application Registration"** (sometimes
labeled "Dynamic Client Registration (DCR)").

**Do this first, before enabling the toggle** — Auth0's own docs are explicit that DCR clients
can't have per-app grants set at registration time, so an API with no default access configured
leaves every DCR client locked out:

- `Applications → APIs → ArtifactHub-Backend-MCP-Dev → Settings → Default Permissions for
  third-party applications`. Our MCP tokens carry **identity, not fine-grained OAuth scopes** (R3 —
  authorization is all `canView`/`canManagePolicy` against the DB, never token claims), so this API
  has no permissions defined at all — the picker showing "No permissions match your filter" is
  expected, not a misconfiguration. If DCR clients end up with zero access after enabling DCR, this
  is the first place to check.

**After enabling DCR**, one more object needs updating:

- `Authentication → Passwordless → Email → Applications` (or the connection's own **Applications**
  tab): the connection must be **promoted to domain-level**. DCR clients are third-party
  applications, and third-party applications can only use domain-level connections — without this,
  Claude can't show the magic-link login screen at all (R5).

**2026 security-mode note:** Auth0 changed DCR's default behavior around April 2026 — tenants
enabling it fresh (any new `ArtifactHub-Dev`/`ArtifactHub-Prod` tenant) get the current, stricter
security controls automatically. Only tenants that had third-party applications configured *before*
that date can opt into a legacy "permissive mode." Nothing to do here — just don't be surprised if
a guide written before 2026 describes slightly different default behavior.

## 2. Resource Parameter Compatibility Profile

**What it is:** MCP clients send the RFC 8707 **`resource`** parameter (naming the MCP audience)
instead of the older `audience` parameter. Auth0 ignores `resource` unless this profile is on — the
practical effect is that **without it, `/mcp` tokens come back opaque and our server can't validate
them at all**, even if DCR + PKCE + login all succeed. This is the setting that makes
`aud` on the issued token equal our `AUTH0_MCP_AUDIENCE`, which is what R2 (audience-bound tokens)
checks.

Toggle, same Advanced settings page: **"Resource Parameter Compatibility Profile"**. Enable
**"Include Issuer in Authorization Responses"** alongside it — also required for the discovery flow
in [`02` §1.1](../architecture/02-auth-identity-and-admin.md) steps 1–4.

## Verifying it worked

The backend serves the Protected Resource Metadata (RFC 9728) an MCP client reads during discovery
— confirm it's up and pointing at the right issuer:

```bash
curl http://localhost:3081/.well-known/oauth-protected-resource/mcp
# { "resource": "http://localhost:3081/mcp",
#   "authorization_servers": ["https://<your-tenant>.auth0.com/"],
#   "resource_name": "Artifact Hub MCP" }

curl -i -X POST http://localhost:3081/mcp
# HTTP/1.1 401 Unauthorized
# WWW-Authenticate: Bearer resource_metadata="http://localhost:3081/.well-known/oauth-protected-resource/mcp"
```

Full end-to-end proof needs a **provisioned** account, not just Auth0 config — a fresh Auth0 login
for an identity that's never been linked to a local `users` row (via
`POST /api/invitations/accept`) still gets denied at the RS by design (R1: never auto-provision).
See [`02` §4](../architecture/02-auth-identity-and-admin.md) for the invitation-accept flow that
does that linking.

Once both toggles are on and a target account is provisioned, point an MCP client's `.mcp.json` (or
Claude Code's `claude mcp add --transport http`) at `http://localhost:3081/mcp` with no
pre-supplied token — discovery → DCR → PKCE → magic link should complete entirely inside the
client's own OAuth flow.
