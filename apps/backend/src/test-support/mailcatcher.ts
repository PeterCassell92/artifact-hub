/**
 * Polls the real local MailCatcher inbox (`.env.test`'s SMTP_HOST/PORT point at it deliberately,
 * same as BUCKET_NAME points at the real local MinIO) for a message to `recipientEmail` sent
 * after `sinceMs` (`Date.now()` at test start) — avoids colliding with messages from other tests
 * or manual dev usage sharing the same inbox.
 */
export interface CaughtMessage {
  id: number;
  subject: string;
  html: string;
  text: string;
}

interface MailCatcherListEntry {
  id: number;
  recipients: string[];
  subject: string;
  created_at: string;
}

const MAILCATCHER_BASE = "http://localhost:1080";

async function fetchText(path: string): Promise<string> {
  const res = await fetch(`${MAILCATCHER_BASE}${path}`);
  return res.text();
}

export async function findCaughtMessageTo(
  recipientEmail: string,
  sinceMs: number,
  { attempts = 20, delayMs = 250 }: { attempts?: number; delayMs?: number } = {},
): Promise<CaughtMessage> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const list = JSON.parse(await fetchText("/messages")) as MailCatcherListEntry[];
    const match = list.find(
      (m) => m.recipients.some((r) => r.includes(recipientEmail)) && Date.parse(m.created_at) >= sinceMs - 1000,
    );
    if (match) {
      const [html, text] = await Promise.all([
        fetchText(`/messages/${match.id}.html`),
        fetchText(`/messages/${match.id}.plain`),
      ]);
      return { id: match.id, subject: match.subject, html, text };
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`No MailCatcher message found for ${recipientEmail} within the poll window`);
}
