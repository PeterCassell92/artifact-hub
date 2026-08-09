import { createDefaultEsmPreset } from "ts-jest";

const preset = createDefaultEsmPreset();

// Strip the `.js` extension that NodeNext ESM requires in source imports so Jest can resolve TS.
const moduleNameMapper = { "^(\\.{1,2}/.*)\\.js$": "$1" };

/**
 * Three projects matching the layered strategy (docs/architecture/09):
 *   unit        → *.unit.test.ts   (pure core; no I/O)
 *   integration → *.int.test.ts    (Express + Testcontainers Postgres)
 *   mcp         → *.mcp.test.ts    (MCP SDK in-memory + HTTP)
 * Run all with `yarn test`, or one with `yarn test:unit|integration|mcp`.
 */
const project = (displayName, match) => ({
  ...preset,
  displayName,
  testEnvironment: "node",
  testMatch: [`<rootDir>/src/**/${match}`],
  moduleNameMapper,
});

/** @type {import('jest').Config} */
export default {
  projects: [
    project("unit", "*.unit.test.ts"),
    project("integration", "*.int.test.ts"),
    project("mcp", "*.mcp.test.ts"),
  ],
};
