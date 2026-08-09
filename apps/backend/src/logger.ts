import pino from "pino";

/** Structured JSON logger (docs/architecture/10). Correlation ids added per-request. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});
