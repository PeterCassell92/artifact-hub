import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { redeemShareLink } from "../api/shareLink";

type State = "loading" | "denied" | "not_found";

/** /s/:token — resolves + redirects to /artifacts/:id (docs/frontend/01 route map). */
export function ShareLinkRedemptionPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    void redeemShareLink(token).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        navigate(`/artifacts/${result.artifactId}`, { replace: true });
      } else {
        setState(result.status === 404 ? "not_found" : "denied");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  if (state === "loading") {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-neutral-600" role="status">
        Resolving link…
      </div>
    );
  }

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-neutral-900">
        {state === "not_found" ? "This link doesn't exist." : "This link no longer grants access."}
      </p>
      <Link to="/" className="text-sm text-neutral-600 underline hover:text-neutral-900">
        Back to Dashboard
      </Link>
    </div>
  );
}
