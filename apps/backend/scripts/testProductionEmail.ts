/**
 * One-off: sends a single real email using the exact same transporter/env as the running server,
 * bypassing the outbox/DB entirely (outboxDrain.ts). Use this to isolate "is SMTP itself broken
 * (bad credentials, wrong host, network)" from "is the outbox/enqueue path broken" when emails
 * aren't showing up — e.g. after rotating SMTP_PASS or changing Resend's config.
 *
 * Usage (from a Fly SSH console, working dir /repo): yarn workspace backend testProductionEmail <email>
 */
import "dotenv/config";
import { getEnv } from "../src/env";
import { sendMail } from "../src/adapters/email/mailer";

async function main() {
  const to = process.argv[2]?.trim();
  if (!to) {
    console.error("Usage: yarn workspace backend testProductionEmail <email>");
    process.exit(1);
  }

  const env = getEnv();
  console.log(
    `[testProductionEmail] host=${env.SMTP_HOST} port=${env.SMTP_PORT} secure=${env.SMTP_SECURE} ` +
      `user=${env.SMTP_USER ?? "(none)"} from=${env.EMAIL_FROM}`,
  );

  const sentAt = new Date().toISOString();
  await sendMail({
    to,
    subject: "Artifact Hub — production email test",
    text: `Test email sent at ${sentAt} to confirm SMTP is working.`,
    html: `<p>Test email sent at ${sentAt} to confirm SMTP is working.</p>`,
  });

  console.log(`[testProductionEmail] Sent to ${to} — check Resend's Logs/Activity page to confirm it was accepted.`);
}

main().catch((err) => {
  console.error("[testProductionEmail] Send failed:");
  console.error(err);
  process.exit(1);
});
