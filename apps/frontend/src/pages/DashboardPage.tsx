import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useGetMeQuery, useGetMyArtifactsQuery, useGetSharedWithMeQuery } from "../store/api";
import { ArtifactListItem } from "../components/ArtifactListItem";
import { audienceLabel } from "../lib/formatters";
import { hasVisitedGetStarted, markVisitedGetStarted } from "../lib/getStartedCookie";

const RECENT_LIMIT = 5;

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

  useEffect(() => {
    if (!hasVisitedGetStarted()) {
      markVisitedGetStarted();
      navigate("/get-started", { replace: true });
    }
  }, [navigate]);

  const isEmpty = mine.data?.items.length === 0 && shared.data?.items.length === 0;

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900">
        {me ? `Welcome, ${me.name ?? me.email}` : "Welcome"}
      </h1>

      {isEmpty && (
        <div className="mt-6 rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          Nothing here yet. Artifacts are published via your agent (e.g. Claude Desktop) using Artifact
          Hub&apos;s MCP tools — this page is for viewing and managing what&apos;s shared.{" "}
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
    </div>
  );
}
