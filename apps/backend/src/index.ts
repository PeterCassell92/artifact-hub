// Load apps/backend/.env into process.env BEFORE anything reads it (getEnv, logger).
// No-ops safely in prod (Fly injects real env; dotenv never overrides existing vars).
import "dotenv/config";
import { createApp } from "./app";
import { getEnv } from "./env";
import { logger } from "./logger";
import { startOutboxDrainLoop } from "./workers/outboxDrain";
import { sendInvitationEmail } from "./workers/handlers/invitationSend";

const env = getEnv();
const app = createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "artifact-hub backend listening (api + mcp)");
});

// Transactional outbox drain loop (docs/architecture/02 §6) — rides the same always-on machine
// kept warm by fly.toml's min_machines_running=1 (for the /mcp OAuth path), so this adds no new
// always-on infra cost.
startOutboxDrainLoop({ "invitation.send": sendInvitationEmail }, env.OUTBOX_POLL_INTERVAL_MS);
