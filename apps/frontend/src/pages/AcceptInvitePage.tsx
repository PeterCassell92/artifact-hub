import { useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { useSearchParams } from "react-router-dom";
import { useAcceptInvitationMutation, useGetInvitationPreviewQuery } from "../store/api";
import { PASSWORDLESS_AUTHORIZATION_PARAMS } from "../auth/passwordlessConnection";

/** /accept-invite?token=... — unauthenticated bootstrap (docs/architecture/02 §4). Only asks for
 * what AcceptInvitationInput actually accepts (the token) — no name field, since the backend
 * never asks for one despite the design doc's "confirms name" aspiration. */
export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { loginWithRedirect } = useAuth0();
  const [accepted, setAccepted] = useState(false);

  const { data: preview, isLoading, error } = useGetInvitationPreviewQuery(token, { skip: !token });
  const [acceptInvitation, { isLoading: isAccepting }] = useAcceptInvitationMutation();

  async function handleAccept() {
    await acceptInvitation(token).unwrap();
    setAccepted(true);
  }

  if (!token) {
    return <p className="p-6 text-center text-neutral-600">Missing invitation link.</p>;
  }

  if (isLoading) {
    return (
      <p className="p-6 text-center text-neutral-600" role="status">
        Loading invitation…
      </p>
    );
  }

  if (error || !preview) {
    return <p className="p-6 text-center text-neutral-600">This invitation is no longer valid.</p>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">You&apos;re invited to Artifact Hub</h1>
        <dl className="mt-4 space-y-1 text-sm text-neutral-600">
          <div>
            <dt className="inline font-medium text-neutral-700">Email: </dt>
            <dd className="inline">{preview.email}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-neutral-700">Role: </dt>
            <dd className="inline">{preview.role}</dd>
          </div>
          {preview.groupNames.length > 0 && (
            <div>
              <dt className="inline font-medium text-neutral-700">Groups: </dt>
              <dd className="inline">{preview.groupNames.join(", ")}</dd>
            </div>
          )}
        </dl>

        {!accepted ? (
          <button
            type="button"
            disabled={isAccepting}
            onClick={() => void handleAccept()}
            className="mt-6 w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            Accept invitation
          </button>
        ) : (
          <>
            <p className="mt-6 text-sm text-green-700" role="status">
              Invitation accepted. Sign in to continue.
            </p>
            <button
              type="button"
              onClick={() =>
                void loginWithRedirect({
                  authorizationParams: { ...PASSWORDLESS_AUTHORIZATION_PARAMS, login_hint: preview.email },
                })
              }
              className="mt-3 w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
