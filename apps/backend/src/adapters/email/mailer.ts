import nodemailer, { type Transporter } from "nodemailer";
import { getEnv } from "#env";
import { logger } from "#logger";

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (!transporter) {
    const env = getEnv();
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** SMTP send (MailCatcher in dev, Resend in prod — same transport, see env.ts). */
export async function sendMail(input: SendMailInput): Promise<void> {
  const env = getEnv();
  try {
    await getTransporter().sendMail({ from: env.EMAIL_FROM, ...input });
    logger.info({ to: input.to, subject: input.subject }, "email sent");
  } catch (err) {
    logger.error({ err, to: input.to, subject: input.subject, smtpHost: env.SMTP_HOST }, "email send failed");
    throw err;
  }
}
