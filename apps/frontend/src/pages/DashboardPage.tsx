import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useGetMeQuery, useGetMyArtifactsQuery, useGetSharedWithMeQuery } from "../store/api";
import { ArtifactListItem } from "../components/ArtifactListItem";
import { PublishArtifactModal } from "../components/PublishArtifactModal";
import { audienceLabel } from "../lib/formatters";
import { hasVisitedGetStarted, markVisitedGetStarted } from "../lib/getStartedCookie";

const RECENT_LIMIT = 3;

/** Landing page after sign-in — recent My Artifacts + Shared With Me (docs/frontend/01 §3).
 * First-ever visit (no `artifact-hub-visited-get-started` cookie) redirects to /get-started once,
 * so new members see the MCP connection instructions before the (likely empty) dashboard. Done in
 * a useEffect, not during render — React.StrictMode double-invokes render bodies in dev, and
 * setting the cookie there would make the second invocation see it as already-visited and skip
 * the redirect. Effects are the correct place for this kind of one-time, idempotent side effect. */
export function DashboardPage() {
  const navigate = useNavigate();
  const { data: me } = useGetMeQuery();
  const mine = useGetMyArtifactsQuery({ limit: RECENT_LIMIT });
  const shared = useGetSharedWithMeQuery({ limit: RECENT_LIMIT });
  const [publishOpen, setPublishOpen] = useState(false);

  useEffect(() => {
    if (!hasVisitedGetStarted()) {
      markVisitedGetStarted();
      navigate("/get-started", { replace: true });
    }
  }, [navigate]);

  const isEmpty = mine.data?.items.length === 0 && shared.data?.items.length === 0;

  return (
    <div>
      <h1 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
        {me ? `Welcome, ${me.name ?? me.email}` : "Welcome"}
        <img src="/icon-waving-hand.svg" alt="" className="h-6 w-6" />
      </h1>

      {isEmpty && (
        <div className="mt-6 rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          Nothing here yet. Publish a file using the button below, or ask your agent (e.g. Claude
          Desktop) to publish one via Artifact Hub&apos;s MCP tools — either way it lands here.{" "}
          <Link to="/get-started" className="text-neutral-700 underline hover:text-neutral-900">
            Get started
          </Link>
        </div>
      )}

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-700">My Artifacts</h2>
          <Link to="/artifacts" className="text-sm text-neutral-500 hover:text-neutral-900">
            View all
          </Link>
        </div>
        <div className="mt-3 flex flex-col gap-3">
          {mine.data?.items.map((artifact) => (
            <ArtifactListItem
              key={artifact.id}
              artifact={artifact}
              secondaryLabel={audienceLabel(artifact.audienceType)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPublishOpen(true)}
          className="mt-4 w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Publish New Artifact
        </button>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-700">Shared With Me</h2>
          <Link to="/shared" className="text-sm text-neutral-500 hover:text-neutral-900">
            View all
          </Link>
        </div>
        <div className="mt-3 flex flex-col gap-3">
          {shared.data?.items.map((artifact) => (
            <ArtifactListItem
              key={artifact.id}
              artifact={artifact}
              secondaryLabel={artifact.publisherName ?? "Unknown publisher"}
            />
          ))}
        </div>
      </section>

      <PublishArtifactModal open={publishOpen} onClose={() => setPublishOpen(false)} />
    </div>
  );
}
