import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import pinoHttp from "pino-http";
import { logger } from "../../logger";

/**
 * Per-request child logger + correlation id (docs/architecture/10 §1) — honors an inbound
 * `X-Request-Id` (e.g. from fly-proxy or an upstream caller), else mints one, and echoes it back
 * on the response so a caller can correlate their request with our logs. Mounted once in app.ts,
 * ahead of both the `/api/*` routers and `/mcp` — MCP requests are ordinary POSTs to `/mcp`
 * through the same Express app, so this single mount covers both surfaces.
 */
export const requestLogging = pinoHttp<Request, Response>({
  logger,
  genReqId: (req, res) => {
    const inbound = req.headers["x-request-id"];
    const id = (Array.isArray(inbound) ? inbound[0] : inbound) || randomUUID();
    res.setHeader("x-request-id", id);
    return id;
  },
  customAttributeKeys: { reqId: "requestId", responseTime: "latencyMs" },
  customProps: (req) => ({
    userId: req.viewer?.id,
    route: req.route?.path ?? req.originalUrl,
  }),
});
