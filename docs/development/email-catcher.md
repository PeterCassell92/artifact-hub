# Dev Email Catcher (MailCatcher)

*Status: dev tooling. Related: [`../architecture/02-auth-identity-and-admin.md`](../architecture/02-auth-identity-and-admin.md)
(invitations + magic-link auth both send email), [`../architecture/07-infrastructure-and-iac.md`](../architecture/07-infrastructure-and-iac.md)
(SES in prod).*

Because both **invitations** and **magic-link sign-in** send real email, local dev needs somewhere
safe to send to. We use **[MailCatcher](https://mailcatcher.me/)** — a tiny Docker service that
runs a fake SMTP server and shows everything it receives in a web inbox. Our email code points its
SMTP transport at MailCatcher in dev instead of a real mailbox, so no real emails go out and we can
click the captured magic/invite links.

## What MailCatcher is

A super-simple SMTP server that **catches every message sent to it** and displays it (HTML + text)
in a web UI. Two ports ([docs](https://github.com/dockage/mailcatcher)):

- **`1025`** — SMTP (where our app sends).
- **`1080`** — Web inbox (open `http://localhost:1080` to read caught mail).

## docker-compose (dev)

Add to the dev `docker-compose.yml` (alongside Postgres):

```yaml
services:
  mailcatcher:
    # dockage/mailcatcher is multi-arch; use chrislpierce/mailcatcher on Apple Silicon if needed
    image: dockage/mailcatcher:latest
    ports:
      - "1025:1025"   # SMTP  — app sends here
      - "1080:1080"   # Web   — read caught mail at http://localhost:1080
    restart: unless-stopped
```

Bring it up with the rest of the dev stack (`docker compose up -d`), then open
`http://localhost:1080`.

## Wiring the backend to it

Our email sending goes through a small **email-provider abstraction** in the backend (driven by the
transactional outbox, see `02` §6). Select the transport by environment:

- **dev** → **SMTP transport (nodemailer)** pointed at MailCatcher.
- **prod** → **AWS SES** (`07`).

Dev `.env` (git-ignored; commit a `.env.example`):

```dotenv
EMAIL_TRANSPORT=smtp
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false          # MailCatcher speaks plain SMTP, no TLS/auth
EMAIL_FROM="Artifact Hub <no-reply@artifact-hub.local>"
```

Prod (from Secrets Manager, not committed):

```dotenv
EMAIL_TRANSPORT=ses
AWS_REGION=...
EMAIL_FROM="Artifact Hub <no-reply@yourdomain>"
```

The code path is identical — only the transport differs — so invitation and magic-link emails are
exercised end-to-end in dev without a real mailbox.

## Typical dev flow

1. `docker compose up -d` (Postgres + MailCatcher).
2. Run the backend with the dev `.env` above.
3. Trigger an email — e.g. admin invites a user, or a user requests a magic-link sign-in.
4. Open `http://localhost:1080`, read the message, and click the invite/magic link.

## Notes & alternatives

- **Auth0 magic-link emails — use the Auth0 dev tenant's email log (DECIDED).** The magic-link
  email is sent by **Auth0's passwordless connection**, not our backend, so it does **not** land in
  MailCatcher. For dev this is fine: **read magic-link emails from the Auth0 dev tenant's own email
  log** (Auth0 dashboard → Monitoring → Logs, or the tenant's dev email view). We are **not**
  configuring a custom Auth0 SMTP provider for dev. **MailCatcher is only for emails our backend
  sends** (invitations and notifications via the outbox) — those always land at
  `http://localhost:1080`.
- **Alternatives** (same idea, SMTP 1025 + web UI): **Mailpit** (actively maintained successor,
  UI on `8025`) and **MailHog** (UI on `8025`). MailCatcher is the default per this note; swapping
  is just a different image + UI port.

## Sources

- MailCatcher project & Docker image — https://github.com/dockage/mailcatcher (SMTP `1025`, web `1080`)
- Apple-Silicon image — https://github.com/cpierce/mailcatcher
- SMTP troubleshooting walkthrough — https://spaquet.medium.com/mailcatcher-to-the-rescue-4ba438dc98c2
