import { useEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { Navigate } from "react-router-dom";
import { PASSWORDLESS_AUTHORIZATION_PARAMS } from "../auth/passwordlessConnection";

/** Email → magic-link entry point (docs/frontend/01 §1). Auth0's Universal Login (configured for
 * the passwordless/email-link connection) collects the email and sends the link — no custom
 * passwordless UI here. */
export function LoginPage() {
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0();

  useEffect(() => {
    document.title = "Sign in — Artifact Hub";
  }, []);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">Artifact Hub</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Sign in with your email to view and manage artifacts shared with you. No password — we&apos;ll
          send you a one-time sign-in link.
        </p>
        <button
          type="button"
          disabled={isLoading}
          onClick={() => void loginWithRedirect({ authorizationParams: PASSWORDLESS_AUTHORIZATION_PARAMS })}
          className="mt-6 w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          Continue with email
        </button>
      </div>
    </div>
  );
}
