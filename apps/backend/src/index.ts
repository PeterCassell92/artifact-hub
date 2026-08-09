import { createApp } from "./app.js";
import { getEnv } from "./env.js";
import { logger } from "./logger.js";

const env = getEnv();
const app = createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "artifact-hub backend listening (api + mcp)");
});
