/**
 * Explicitly targets the tenant's passwordless email connection (dashboard name: "email") on
 * every `loginWithRedirect` call. Auth0's New Universal Login "Identifier + Password" profile
 * doesn't recognize a passwordless-only connection as valid on its combined form — depending on
 * the tenant's Authentication Profile setting alone produced "no connections enabled for the
 * client". Passing `connection` explicitly skips that resolution entirely, matching CLAUDE.md's
 * "passwordless (magic link) auth ... no passwords" for every human login path.
 */
export const PASSWORDLESS_AUTHORIZATION_PARAMS = { connection: "email" };
