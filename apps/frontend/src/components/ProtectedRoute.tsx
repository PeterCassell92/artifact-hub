import { useEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { Outlet, useLocation } from "react-router-dom";
import { PASSWORDLESS_AUTHORIZATION_PARAMS } from "../auth/passwordlessConnection";

/**
 * No anonymous access (CLAUDE.md) — redirects to Auth0 Universal Login, then back to here.
 *
 * Must NOT retry `loginWithRedirect` when Auth0 reports an `error` — e.g. `handleRedirectCallback`
 * can be invoked twice under React.StrictMode's double-effect-invocation in dev, and the second
 * call fails ("Invalid state") because the authorization code was already consumed. Retrying
 * unconditionally on `!isAuthenticated` turns that single failure into an infinite bounce between
 * the app and Auth0 (redirect loop) — surface the error instead and let the user retry manually.
 */
export function ProtectedRoute() {
  const { isLoading, isAuthenticated, error, loginWithRedirect } = useAuth0();
  const location = useLocation();

  // `location` deliberately isn't a dependency here — re-running this on every navigation would
  // re-trigger loginWithRedirect before Auth0 has settled post-callback. Only the loading/auth/
  // error transition should ever (re-)trigger a login attempt.
  useEffect(() => {
    if (!isLoading && !isAuthenticated && !error) {
      void loginWithRedirect({
        appState: { returnTo: location.pathname + location.search },
        authorizationParams: PASSWORDLESS_AUTHORIZATION_PARAMS,
      });
    }
  }, [isLoading, isAuthenticated, error, loginWithRedirect]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center" role="alert">
        <p className="text-neutral-900">Sign-in failed: {error.message}</p>
        <button
          type="button"
          onClick={() =>
            void loginWithRedirect({
              appState: { returnTo: location.pathname + location.search },
              authorizationParams: PASSWORDLESS_AUTHORIZATION_PARAMS,
            })
          }
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center text-neutral-600" role="status">
        Signing you in…
      </div>
    );
  }

  return <Outlet />;
}
