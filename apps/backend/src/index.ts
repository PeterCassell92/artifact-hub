// Load apps/backend/.env into process.env BEFORE anything reads it (getEnv, logger).
// No-ops safely in prod (Fly injects real env; dotenv never overrides existing vars).
import "dotenv/config";
import { createApp } from "./app";
import { getEnv } from "./env";
import { logger } from "./logger";

const env = getEnv();
const app = createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "artifact-hub backend listening (api + mcp)");
});
