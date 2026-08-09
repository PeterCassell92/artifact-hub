/**
 * Idempotent seed — safe to run on every deploy (see docs/architecture/02 §5).
 *
 *  1. Seeds the initial groups.
 *  2. Creates one admin `users` row per email in INITIAL_ADMIN_EMAILS (comma-separated),
 *     role=admin, status=invited.
 *
 * TODO (implementation): enqueue an OutboxEvent per seeded admin so the invitation email
 * (magic-link sign-in) is sent via the outbox worker. Left out here until the email/outbox
 * modules exist — creating the rows is idempotent and safe on its own.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const INITIAL_GROUPS = ["Product", "Development"];

function parseAdminEmails(): string[] {
  return (process.env.INITIAL_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function main() {
  // 1. Groups (idempotent via unique name)
  for (const name of INITIAL_GROUPS) {
    await prisma.group.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // 2. Initial admins (idempotent via unique email)
  const adminEmails = parseAdminEmails();
  if (adminEmails.length === 0) {
    console.warn("[seed] INITIAL_ADMIN_EMAILS is empty — no admins seeded.");
  }
  for (const email of adminEmails) {
    await prisma.user.upsert({
      where: { email },
      update: {}, // do not clobber an existing user's role/status
      create: { email, role: "admin", status: "invited" },
    });
    // TODO: enqueue OutboxEvent { type: "invitation.send", idempotencyKey: `seed-admin:${email}` }
  }

  console.log(
    `[seed] groups=${INITIAL_GROUPS.length} admins=${adminEmails.length}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
