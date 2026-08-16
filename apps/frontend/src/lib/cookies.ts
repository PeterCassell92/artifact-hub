export function hasCookie(name: string): boolean {
  return document.cookie.split("; ").some((entry) => entry.startsWith(`${name}=`));
}

/** First-party, non-sensitive flags only — no `Secure` (would break on http://localhost). */
export function setCookie(name: string, value: string, maxAgeSeconds: number): void {
  document.cookie = `${name}=${value}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
}
