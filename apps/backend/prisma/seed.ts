/**
 * Idempotent seed — safe to run on every deploy (see docs/architecture/02 §5).
 *
 *  1. Seeds the initial groups.
 *  2. Creates one admin `users` row per email in INITIAL_ADMIN_EMAILS (comma-separated),
 *     role=admin, status=invited, and fires the same "invitation.send" outbox event (and Resend
 *     email) a normal admin-driven invite would — so a seeded admin accepts + gets their Auth0
 *     account provisioned exactly like anyone else (`acceptInvitation` already upserts against a
 *     pre-seeded row, see database-service/invitations.ts). Only for emails that don't already
 *     have a `users` row — re-running seed must never re-invite/re-email an existing admin.
 */
import { prisma } from "../src/db";
import { createInvitation } from "../src/database-service/invitations";
import { nameFromEmail } from "../src/database-service/adminUsers";

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

  // 2. Initial admins — idempotent via a pre-check, not upsert: an upsert can't tell us whether
  // the row was freshly created, and we must only invite/email brand-new admins.
  const adminEmails = parseAdminEmails();
  if (adminEmails.length === 0) {
    console.warn("[seed] INITIAL_ADMIN_EMAILS is empty — no admins seeded.");
  }

  let created = 0;
  for (const email of adminEmails) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) continue; // already seeded (or otherwise provisioned) — never re-invite

    // Every user requires a display name; seeded admins have no admin-provided one yet, so derive
    // a placeholder from the email the same way the require_user_name migration's backfill does.
    const name = nameFromEmail(email);
    const user = await prisma.user.create({ data: { email, name, role: "admin", status: "invited" } });
    await createInvitation({ email, name, role: "admin", groupIds: [], invitedById: user.id });
    created++;
  }

  console.log(
    `[seed] groups=${INITIAL_GROUPS.length} admins=${adminEmails.length} newly-invited=${created}`,
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
