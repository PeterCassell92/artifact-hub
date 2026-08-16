import { config } from "dotenv";
import path from "node:path";

// Runs before every test file. Loads dummy/non-secret test env values (see .env.test) so
// getEnv() has everything it needs; *.int.test.ts files override DATABASE_URL themselves once
// their Testcontainers Postgres is up (see src/test-support/testDatabase.ts).
config({ path: path.resolve(process.cwd(), ".env.test") });
