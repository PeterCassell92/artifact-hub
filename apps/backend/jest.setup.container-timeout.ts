import { jest } from "@jest/globals";

// testTimeout isn't a supported per-project key under Jest's `projects` config — set it here
// instead (integration/mcp projects only; see jest.config.mjs). Testcontainers pulls/starts a
// real Postgres per suite, which needs more than Jest's 5s default.
jest.setTimeout(60_000);
