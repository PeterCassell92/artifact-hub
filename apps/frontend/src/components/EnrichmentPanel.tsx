import { useEffect, useRef, useState } from "react";
import { useGetEnrichmentHistoryQuery, useTriggerEnrichmentMutation, api } from "../store/api";
import { useAppDispatch } from "../store/hooks";
import { notify } from "../store/slices/notifications";
import { enrichmentStatusLabel, formatPublishedAtWithTime } from "../lib/formatters";
import { ArtifactTags } from "./ArtifactTags";
import { ConversationSummary } from "./ConversationSummary";

const ACTIVE_STATUSES = new Set(["pending", "running"]);
const POLL_INTERVAL_MS = 3000;

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-neutral-100 text-neutral-600",
  running: "bg-blue-50 text-blue-700",
  completed: "bg-green-50 text-green-700",
  failed: "bg-red-50 text-red-700",
  skipped: "bg-neutral-100 text-neutral-500",
};

/**
 * Owner-only (the artifact detail page only renders this when `artifact.canManagePolicy` is
 * true — the server enforces the same owner-only gate independently on `GET .../enrichment`).
 * Polls while the latest run is pending/running, stopping once terminal — no websockets in this
 * codebase, so this is plain RTK Query `pollingInterval`, not a hand-rolled timer.
 */
export function EnrichmentPanel({ artifactId }: { artifactId: string }) {
  const [pollingInterval, setPollingInterval] = useState(POLL_INTERVAL_MS);
  const { data, isLoading } = useGetEnrichmentHistoryQuery(artifactId, { pollingInterval });
  const [triggerEnrichment, { isLoading: isTriggering }] = useTriggerEnrichmentMutation();
  const dispatch = useAppDispatch();

  const latest = data?.items[0];
  const isActive = latest ? ACTIVE_STATUSES.has(latest.status) : true; // unknown yet — keep polling until we know

  useEffect(() => {
    setPollingInterval(isActive ? POLL_INTERVAL_MS : 0);
  }, [isActive]);

  // Once a run completes, the artifact's own tags/aiSummary/aiTopics changed server-side —
  // refetch the detail view so the rest of the page (not just this panel) picks it up.
  const lastNotifiedRunId = useRef<string | null>(null);
  useEffect(() => {
    if (latest?.status === "completed" && lastNotifiedRunId.current !== latest.id) {
      lastNotifiedRunId.current = latest.id;
      dispatch(api.util.invalidateTags([{ type: "Artifact", id: artifactId }]));
    }
  }, [latest?.id, latest?.status, artifactId, dispatch]);

  async function handleRerun() {
    try {
      await triggerEnrichment(artifactId).unwrap();
      dispatch(notify("success", "Re-running enrichment…"));
    } catch {
      dispatch(notify("error", "Failed to start enrichment — try again"));
    }
  }

  if (isLoading) {
    return (
      <p className="text-sm text-neutral-500" role="status">
        Loading enrichment status…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!latest ? (
        <p className="text-sm text-neutral-500">No enrichment run yet.</p>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-white p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[latest.status]}`}>
              {enrichmentStatusLabel(latest.status)}
            </span>
            <span className="text-xs text-neutral-500">
              {latest.trigger === "rerun" ? "Manual rerun" : "Auto (on publish)"} · {formatPublishedAtWithTime(latest.createdAt)}
            </span>
          </div>

          {latest.status === "completed" && (
            <div className="flex flex-col gap-2 text-xs text-neutral-600">
              {latest.tagsAdded.length > 0 && (
                <div>
                  <span className="font-medium text-neutral-700">Added tags</span>
                  <div className="mt-1">
                    <ArtifactTags
                      tags={latest.tagsAdded.map((name) => ({ name, source: "ai" as const, confidence: null }))}
                    />
                  </div>
                </div>
              )}
              {latest.relationshipsProposed.filter((r) => r.accepted).length > 0 && (
                <p>Proposed {latest.relationshipsProposed.filter((r) => r.accepted).length} relationship(s).</p>
              )}
              {latest.tagsAdded.length === 0 && latest.relationshipsProposed.filter((r) => r.accepted).length === 0 && (
                <p>No new tags or relationships found.</p>
              )}
              {latest.conversationSummary && (
                <ConversationSummary
                  summary={latest.conversationSummary}
                  messageCount={latest.conversationMessageCount}
                  firstMessageDateTime={latest.conversationFirstMessageAt}
                  finalMessageDateTime={latest.conversationFinalMessageAt}
                />
              )}
            </div>
          )}

          {latest.status === "failed" && latest.error && <p className="text-xs text-red-600">{latest.error}</p>}
        </div>
      )}

      <button
        type="button"
        disabled={isTriggering || isActive}
        onClick={() => void handleRerun()}
        className="self-start rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
      >
        {isActive ? "Enrichment in progress…" : "Re-run enrichment"}
      </button>
    </div>
  );
}
