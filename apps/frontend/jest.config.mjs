import { createDefaultEsmPreset } from "ts-jest";

const preset = createDefaultEsmPreset({ tsconfig: "tsconfig.json" });

/** @type {import('jest').Config} */
export default {
  ...preset,
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testMatch: ["<rootDir>/src/**/*.test.tsx"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
