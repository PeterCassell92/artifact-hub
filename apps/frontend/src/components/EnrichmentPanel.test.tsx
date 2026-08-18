import { jest } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import type { ArtifactEnrichmentListResponse } from "contracts";
import { makeStore } from "../store/store";
import { NotificationRegion } from "./NotificationRegion";

const useGetEnrichmentHistoryQuery =
  jest.fn<(artifactId: string, opts?: { pollingInterval?: number }) => { isLoading: boolean; data?: ArtifactEnrichmentListResponse }>();
const triggerUnwrap = jest.fn<() => Promise<{ enrichmentId: string; status: string }>>();
const triggerEnrichment = jest.fn(() => ({ unwrap: triggerUnwrap }));

jest.unstable_mockModule("../store/api", () => ({
  useGetEnrichmentHistoryQuery: (artifactId: string, opts?: { pollingInterval?: number }) =>
    useGetEnrichmentHistoryQuery(artifactId, opts),
  useTriggerEnrichmentMutation: () => [triggerEnrichment, { isLoading: false }],
  api: { util: { invalidateTags: (tags: unknown) => ({ type: "api/invalidateTags", payload: tags }) } },
}));

const { EnrichmentPanel } = await import("./EnrichmentPanel");

function renderWithStore() {
  return render(
    <Provider store={makeStore()}>
      <NotificationRegion />
      <EnrichmentPanel artifactId="artifact-1" />
    </Provider>,
  );
}

const completedRun: ArtifactEnrichmentListResponse["items"][number] = {
  id: "run-1",
  status: "completed",
  trigger: "publish",
  requestedByName: "Ada Lovelace",
  startedAt: "2026-01-15T10:00:00.000Z",
  completedAt: "2026-01-15T10:00:05.000Z",
  error: null,
  summary: "A write-up about the service mesh.",
  topics: ["service mesh"],
  tagsAdded: ["architecture"],
  relationshipsProposed: [{ toId: "artifact-2", type: "related_to", confidence: 0.9, accepted: true }],
  conversationSummary: null,
  conversationMessageCount: null,
  conversationFirstMessageAt: null,
  conversationFinalMessageAt: null,
  createdAt: "2026-01-15T10:00:00.000Z",
};

describe("EnrichmentPanel", () => {
  beforeEach(() => {
    triggerEnrichment.mockClear();
    triggerUnwrap.mockClear();
  });

  it("shows an empty state and keeps polling when there's no run yet", () => {
    useGetEnrichmentHistoryQuery.mockReturnValue({ isLoading: false, data: { items: [] } });

    renderWithStore();

    expect(screen.getByText(/no enrichment run yet/i)).toBeInTheDocument();
    expect(useGetEnrichmentHistoryQuery).toHaveBeenLastCalledWith("artifact-1", { pollingInterval: 3000 });
  });

  it("shows the completed run's summary/tags and stops polling", async () => {
    useGetEnrichmentHistoryQuery.mockReturnValue({ isLoading: false, data: { items: [completedRun] } });

    renderWithStore();

    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Added tags")).toBeInTheDocument();
    expect(screen.getByText("architecture")).toBeInTheDocument();
    expect(screen.getByText(/proposed 1 relationship\(s\)/i)).toBeInTheDocument();
    await waitFor(() => expect(useGetEnrichmentHistoryQuery).toHaveBeenLastCalledWith("artifact-1", { pollingInterval: 0 }));
  });

  it("shows the conversation summary when the run detected one", () => {
    useGetEnrichmentHistoryQuery.mockReturnValue({
      isLoading: false,
      data: { items: [{ ...completedRun, conversationSummary: "Discussed and fixed the DMARC record." }] },
    });
    renderWithStore();
    expect(screen.getByText(/discussed and fixed the dmarc record/i)).toBeInTheDocument();
  });

  it("omits the conversation summary line when the run didn't detect one", () => {
    useGetEnrichmentHistoryQuery.mockReturnValue({ isLoading: false, data: { items: [completedRun] } });
    renderWithStore();
    expect(screen.queryByText(/conversation summary/i)).not.toBeInTheDocument();
  });

  it("shows the error message for a failed run", () => {
    useGetEnrichmentHistoryQuery.mockReturnValue({
      isLoading: false,
      data: { items: [{ ...completedRun, status: "failed", error: "bedrock unavailable", summary: null, topics: [], tagsAdded: [], relationshipsProposed: [] }] },
    });

    renderWithStore();

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("bedrock unavailable")).toBeInTheDocument();
  });

  it("disables the rerun button while a run is pending or running", () => {
    useGetEnrichmentHistoryQuery.mockReturnValue({
      isLoading: false,
      data: { items: [{ ...completedRun, status: "running" }] },
    });

    renderWithStore();

    expect(screen.getByRole("button", { name: /enrichment in progress/i })).toBeDisabled();
  });

  it("triggers a rerun and shows a success notification", async () => {
    useGetEnrichmentHistoryQuery.mockReturnValue({ isLoading: false, data: { items: [completedRun] } });
    triggerUnwrap.mockResolvedValue({ enrichmentId: "run-2", status: "pending" });
    renderWithStore();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /re-run enrichment/i }));

    expect(triggerEnrichment).toHaveBeenCalledWith("artifact-1");
    expect(await screen.findByText(/re-running enrichment/i)).toBeInTheDocument();
  });

  it("shows an error notification when triggering a rerun fails", async () => {
    useGetEnrichmentHistoryQuery.mockReturnValue({ isLoading: false, data: { items: [completedRun] } });
    triggerUnwrap.mockRejectedValue(new Error("network error"));
    renderWithStore();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /re-run enrichment/i }));

    expect(await screen.findByText(/failed to start enrichment/i)).toBeInTheDocument();
  });
});
