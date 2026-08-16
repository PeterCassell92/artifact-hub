/**
 * One-off: re-sends the invitation email for a user who's stuck in status="invited" — e.g. the
 * INITIAL_ADMIN_EMAILS seed (prisma/seed.ts) creates the admin `users` row and an `invitations`
 * row + outbox event, but if outbox draining/Resend wasn't wired up yet when you first ran
 * `db:seed`, that original email never actually sent. Re-running `db:seed` won't help — it
 * deliberately skips emails that already have a `users` row (never re-invite/re-email on redeploy).
 *
 * This creates a FRESH `invitations` row (new token, new 7-day expiry — the old one may be stale
 * or expired by now) for that existing user, reusing the same self-invite mechanism the seed
 * script uses (`invitedById` = the user's own id), then drains that one outbox event immediately
 * so you don't have to wait for the poll interval or even have the server running.
 *
 * Usage (from apps/backend): yarn reinvite <email>
 */
import "dotenv/config";
import { prisma } from "../src/db";
import { createInvitation } from "../src/database-service/invitations";
import { drainOutboxOnce } from "../src/workers/outboxDrain";
import { sendInvitationEmail } from "../src/workers/handlers/invitationSend";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: yarn reinvite <email>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`[reinvite] No user found for ${email}. For a brand-new user, use the admin`);
    console.error("[reinvite] invite flow instead (POST /api/admin/invitations) once an admin can sign in.");
    process.exit(1);
  }
  if (user.status !== "invited") {
    console.error(`[reinvite] ${email} is already status="${user.status}" — nothing to re-send.`);
    process.exit(1);
  }

  // Preserve any groups already assigned (there won't be any yet for a never-accepted invite,
  // but this keeps the script correct if it's ever pointed at a corrective re-invite later).
  const memberships = await prisma.groupMembership.findMany({ where: { userId: user.id } });

  const { invitation } = await createInvitation({
    email: user.email,
    role: user.role,
    groupIds: memberships.map((m) => m.groupId),
    invitedById: user.id, // self-invite — same bootstrap trick as prisma/seed.ts
  });

  console.log(`[reinvite] Created invitation ${invitation.id} for ${email}, expires ${invitation.expiresAt.toISOString()}.`);
  console.log("[reinvite] Draining the outbox now so the email sends immediately...");

  await drainOutboxOnce({ "invitation.send": sendInvitationEmail });

  console.log("[reinvite] Done. Check your inbox (or MailCatcher at http://localhost:1080 in dev).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
