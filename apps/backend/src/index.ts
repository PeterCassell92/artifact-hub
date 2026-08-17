// Load apps/backend/.env into process.env BEFORE anything reads it (getEnv, logger).
// No-ops safely in prod (Fly injects real env; dotenv never overrides existing vars).
import "dotenv/config";
import { createApp } from "./app";
import { getEnv } from "./env";
import { logger } from "./logger";
import { startOutboxDrainLoop } from "./workers/outboxDrain";
import { sendInvitationEmail } from "./workers/handlers/invitationSend";
import { provisionAuth0User } from "./workers/handlers/auth0ProvisionUser";
import { sendNewArtifactAccessEmail } from "./workers/handlers/newArtifactAccess";
import { sendAccessRevokedEmail } from "./workers/handlers/accessRevoked";
import { sendNewCommentEmail } from "./workers/handlers/newComment";

const env = getEnv();
const app = createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "artifact-hub backend listening (api + mcp)");
});

// Email is entirely best-effort/async via the outbox (never blocks a request or boot), but a
// missing Resend config in prod would otherwise fail silently until the first outbox event
// exhausts its retries — surface it loudly and immediately instead.
if (env.NODE_ENV === "production" && (!env.SMTP_USER || !env.SMTP_PASS)) {
  logger.warn(
    { smtpHost: env.SMTP_HOST },
    "SMTP_USER/SMTP_PASS are not set in production — invitation and notification emails will fail to send",
  );
}

// Transactional outbox drain loop (docs/architecture/02 §6) — rides the same always-on machine
// kept warm by fly.toml's min_machines_running=1 (for the /mcp OAuth path), so this adds no new
// always-on infra cost.
startOutboxDrainLoop(
  {
    "invitation.send": sendInvitationEmail,
    "auth0.provision_user": provisionAuth0User,
    "artifact.new_access": sendNewArtifactAccessEmail,
    "artifact.access_revoked": sendAccessRevokedEmail,
    "artifact.new_comment": sendNewCommentEmail,
  },
  env.OUTBOX_POLL_INTERVAL_MS,
);
