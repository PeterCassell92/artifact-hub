import { getAccessToken } from "../auth/tokenBridge";
import { API_BASE_URL } from "../config";

export type RedeemShareLinkResult =
  | { ok: true; artifactId: string }
  | { ok: false; status: number };

/**
 * GET /api/s/:token (docs/architecture/06 §4) — NOT an RTK Query endpoint. The backend responds
 * with a 302 to `${APP_ORIGIN}/artifacts/:id`, i.e. OUR OWN frontend origin, so a plain `fetch`
 * (which follows redirects by default) ends the chain same-origin — no third-party CORS
 * dependency (unlike /download, whose final hop is Tigris). We read the resolved path off
 * `response.url` and hand it to the router instead of doing a full page navigation.
 */
export async function redeemShareLink(token: string): Promise<RedeemShareLinkResult> {
  const authToken = await getAccessToken();
  const res = await fetch(`${API_BASE_URL}/s/${token}`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });

  if (!res.ok) {
    return { ok: false, status: res.status };
  }

  const pathname = new URL(res.url).pathname;
  const artifactId = pathname.split("/").pop();
  if (!artifactId) {
    return { ok: false, status: 500 };
  }

  return { ok: true, artifactId };
}
