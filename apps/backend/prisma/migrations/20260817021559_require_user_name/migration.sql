-- Expand/contract: backfill any existing NULL names before enforcing NOT NULL, so this is safe
-- to run against real data, not just a throwaway dev DB. Derives a reasonable placeholder from
-- the email local-part (e.g. "peter.cassell@x.com" -> "Peter Cassell") — every user now requires
-- a display name, set by the admin at invite time going forward.
UPDATE "User"
SET "name" = INITCAP(REPLACE(REPLACE(SPLIT_PART("email", '@', 1), '.', ' '), '_', ' '))
WHERE "name" IS NULL;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "name" SET NOT NULL;
