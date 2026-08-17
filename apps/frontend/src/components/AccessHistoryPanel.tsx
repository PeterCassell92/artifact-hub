import { useState } from "react";
import { useGetAccessEventsQuery } from "../store/api";
import { accessActionLabel, accessDenyReasonLabel, accessRouteLabel, formatPublishedAtWithTime } from "../lib/formatters";

/**
 * Owner/admin-only (the artifact detail page only renders this when
 * `artifact.canViewAccessEvents` is true — the server enforces the same gate independently).
 * Newest-first, "Load more" pages through `nextCursor` the same way MyArtifactsPage/
 * SharedWithMePage do: a stack of visited cursors, swapping the visible page rather than
 * accumulating rows.
 */
export function AccessHistoryPanel({ artifactId }: { artifactId: string }) {
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const { data, isLoading, isFetching } = useGetAccessEventsQuery({ artifactId, cursor });

  if (isLoading) {
    return (
      <p className="text-sm text-neutral-500" role="status">
        Loading access history…
      </p>
    );
  }

  if (!data || data.items.length === 0) {
    return <p className="text-sm text-neutral-500">No views or downloads recorded yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {data.items.map((event) => (
          <li
            key={event.id}
            className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-white p-3 text-sm"
          >
            <div className="min-w-0">
              <span className="font-medium text-neutral-900">{event.userName}</span>{" "}
              <span className="text-neutral-500">({event.userEmail})</span>
              <p className="mt-0.5 text-xs text-neutral-500">
                {accessActionLabel(event.action)} via {accessRouteLabel(event.route)} ·{" "}
                {formatPublishedAtWithTime(event.at)}
              </p>
            </div>
            <span
              className={
                event.decision === "denied"
                  ? "shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700"
                  : "shrink-0 rounded bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700"
              }
            >
              {event.decision === "denied" ? accessDenyReasonLabel(event.denyReason) : "Allowed"}
            </span>
          </li>
        ))}
      </ul>

      {data.nextCursor && (
        <button
          type="button"
          disabled={isFetching}
          onClick={() => setCursors((prev) => [...prev, data.nextCursor as string])}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          {isFetching ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
