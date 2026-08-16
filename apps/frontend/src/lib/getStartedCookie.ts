import { hasCookie, setCookie } from "./cookies";

const COOKIE_NAME = "artifact-hub-visited-get-started";
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export function hasVisitedGetStarted(): boolean {
  return hasCookie(COOKIE_NAME);
}

export function markVisitedGetStarted(): void {
  setCookie(COOKIE_NAME, "1", ONE_YEAR_SECONDS);
}
