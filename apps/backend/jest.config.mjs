import { createDefaultEsmPreset } from "ts-jest";

const preset = createDefaultEsmPreset();

/**
 * Three projects matching the layered strategy (docs/architecture/09):
 *   unit        → *.unit.test.ts   (pure core; no I/O)
 *   integration → *.int.test.ts    (Express + Testcontainers Postgres)
 *   mcp         → *.mcp.test.ts    (MCP SDK in-memory + HTTP)
 * Run all with `yarn test`, or one with `yarn test:unit|integration|mcp`.
 */
const project = (displayName, match, extra = {}) => ({
  ...preset,
  displayName,
  testEnvironment: "node",
  testMatch: [`<rootDir>/src/**/${match}`],
  setupFiles: ["<rootDir>/jest.setup.ts"],
  ...extra,
});

// Testcontainers pulls/starts a real Postgres per suite — allow more time than the 5s default.
// `testTimeout` isn't a supported per-project key, so it's set via setupFilesAfterEnv instead.
const containerTestConfig = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.container-timeout.ts"],
};

/** @type {import('jest').Config} */
export default {
  projects: [
    project("unit", "*.unit.test.ts"),
    project("integration", "*.int.test.ts", containerTestConfig),
    project("mcp", "*.mcp.test.ts", containerTestConfig),
  ],
};
