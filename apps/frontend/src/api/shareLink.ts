import { ShareLinkRedemptionResponse } from "contracts";
import { getAccessToken } from "../auth/tokenBridge";
import { API_BASE_URL } from "../config";

export type RedeemShareLinkResult =
  | { ok: true; artifactId: string }
  | { ok: false; status: number };

/**
 * GET /api/s/:token (docs/architecture/06 §4) — NOT an RTK Query endpoint. Asks for
 * `Accept: application/json` so the backend returns `{ artifactId }` directly instead of its
 * default 302 (like `resolveDownloadUrl` does for `/download`). A plain `fetch` can't just follow
 * that 302: it targets our own frontend origin, but the redirect chain still started cross-origin
 * (backend -> frontend), and once a fetch redirect chain crosses an origin boundary the *whole*
 * chain is CORS-tainted — even a hop landing back on our own origin needs an
 * Access-Control-Allow-Origin header, which a plain SPA page response will never have.
 */
export async function redeemShareLink(token: string): Promise<RedeemShareLinkResult> {
  const authToken = await getAccessToken();
  const res = await fetch(`${API_BASE_URL}/s/${token}`, {
    headers: {
      Accept: "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
  });

  if (!res.ok) {
    return { ok: false, status: res.status };
  }

  const body = ShareLinkRedemptionResponse.safeParse(await res.json());
  if (!body.success) {
    return { ok: false, status: 500 };
  }

  return { ok: true, artifactId: body.data.artifactId };
}
