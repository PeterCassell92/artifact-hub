# Email adapter

`mailer.ts` sends email over SMTP using [nodemailer](https://nodemailer.com/). **Nodemailer is a
client library, not an email service** — it doesn't have its own account. It just connects to
whatever SMTP server `SMTP_HOST`/`SMTP_PORT`/etc. (`env.ts`) point it at. Which server that is
changes per environment; the code never branches on environment.

## Dev — MailCatcher (no account needed)

`SMTP_HOST=localhost:1025` points at the **MailCatcher** container brought up by
`docker compose up -d` ([`docker-compose.yml`](../../../../../docker-compose.yml)). It's a fake
SMTP server: it accepts anything nodemailer sends and shows it at
**http://localhost:1080** — nothing is actually delivered anywhere. Zero setup required. See
[`docs/development/email-catcher.md`](../../../../../docs/development/email-catcher.md).

## Prod — Resend (real account required)

`SMTP_HOST=smtp.resend.com` — nodemailer connects to **[Resend](https://resend.com)**'s SMTP
endpoint instead. Resend is the actual email-sending service (same role as SendGrid/Postmark).
Before deploying, you need:

1. A Resend account + a **verified sending domain**.
2. A Resend API key, set as the `SMTP_PASS` **fly secret** (never committed) — see
   [`.env.example`](../../../.env.example) for the full prod var block (`SMTP_USER=resend`,
   `SMTP_PORT=465`, `SMTP_SECURE=true`, `EMAIL_FROM` on the verified domain).

Full picture: [`docs/architecture/02-auth-identity-and-admin.md`](../../../../../docs/architecture/02-auth-identity-and-admin.md)
§4/§6 (why email is sent), [`07-infrastructure-and-iac.md`](../../../../../docs/architecture/07-infrastructure-and-iac.md)
(Resend as a prod dependency).

## Who calls this

Not called directly from request handlers — only from outbox drain handlers
(`../../workers/handlers/`), which run async after the domain change already committed. See the
transactional-outbox pattern in `02` §6 and [`../../workers/outboxDrain.ts`](../../workers/outboxDrain.ts).
Currently one handler: `invitationSend.ts` (emails the accept-invite link).
