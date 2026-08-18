import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";
import type { ArtifactDetail, ReissueUploadUrlResponse } from "contracts";
import { makeStore } from "../store/store";
import { NotificationRegion } from "../components/NotificationRegion";

const pendingArtifact: ArtifactDetail = {
  id: "a1",
  ownerId: "owner-1",
  title: "Q3 report",
  fileName: "report.pdf",
  contentType: "application/pdf",
  kind: "document",
  sizeBytes: 0,
  publisherName: "Ada",
  publishedAt: "2026-01-01T00:00:00.000Z",
  audienceType: "specific_users",
  expiresAt: null,
  isExpired: false,
  revoked: false,
  commentCount: 0,
  description: null,
  canManagePolicy: true,
  canViewAccessEvents: true,
  tags: [],
  aiSummary: null,
  aiTopics: [],
  conversationSummary: null,
  conversationMessageCount: null,
  conversationFirstMessageAt: null,
  conversationFinalMessageAt: null,
};

let queryResult: { data?: ArtifactDetail; isLoading: boolean; error?: unknown };

const reissueUnwrap = jest.fn<() => Promise<ReissueUploadUrlResponse>>();
const reissueUploadUrl = jest.fn(() => ({ unwrap: reissueUnwrap }));
const finalizeUnwrap = jest.fn<() => Promise<ArtifactDetail>>();
const finalizeArtifact = jest.fn(() => ({ unwrap: finalizeUnwrap }));

jest.unstable_mockModule("../store/api", () => ({
  useGetArtifactQuery: () => queryResult,
  useReissueUploadUrlMutation: () => [reissueUploadUrl, { isLoading: false }],
  useFinalizeArtifactMutation: () => [finalizeArtifact, { isLoading: false }],
}));

const { CompleteUploadPage } = await import("./CompleteUploadPage");

function renderPage(route = "/artifacts/a1/complete-upload") {
  return render(
    <Provider store={makeStore()}>
      <NotificationRegion />
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/artifacts/:id/complete-upload" element={<CompleteUploadPage />} />
          <Route path="/artifacts/:id" element={<div>artifact detail page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

// jsdom doesn't define `fetch`, so there's nothing for `jest.spyOn(global, "fetch")` to spy on.
function mockFetch(response: Partial<Response>) {
  const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(response as Response);
  global.fetch = fetchMock;
  return fetchMock;
}

async function selectFile(user: ReturnType<typeof userEvent.setup>, file: File) {
  const input = screen.getByLabelText(/choose the file to upload/i);
  await user.upload(input, file);
}

describe("CompleteUploadPage", () => {
  beforeEach(() => {
    queryResult = { data: pendingArtifact, isLoading: false };
    reissueUploadUrl.mockClear();
    reissueUnwrap.mockReset().mockResolvedValue({ uploadUrl: "https://storage.test/artifacts/a1/report.pdf" });
    finalizeArtifact.mockClear();
    finalizeUnwrap.mockReset().mockResolvedValue({} as ArtifactDetail);
  });

  it("disables the upload button until a file is picked", async () => {
    const user = userEvent.setup();
    renderPage();

    const button = screen.getByRole("button", { name: /upload and publish/i });
    expect(button).toBeDisabled();

    await selectFile(user, new File(["hello"], "report.pdf", { type: "application/pdf" }));
    expect(button).toBeEnabled();
  });

  it("re-mints an upload URL, PUTs with the artifact's stored contentType, finalizes, and navigates to the detail page", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ ok: true });
    renderPage();

    // A picked file whose browser-reported type differs from the stored contentType — the PUT
    // must use the stored one (what the presigned URL was signed with), not file.type.
    await selectFile(user, new File(["hello"], "report.pdf", { type: "application/octet-stream" }));
    await user.click(screen.getByRole("button", { name: /upload and publish/i }));

    expect(reissueUploadUrl).toHaveBeenCalledWith("a1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.test/artifacts/a1/report.pdf",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
      }),
    );
    expect(finalizeArtifact).toHaveBeenCalledWith({ artifactId: "a1" });
    expect(await screen.findByText("artifact detail page")).toBeInTheDocument();
  });

  it("shows an error notification and does not finalize when the PUT fails", async () => {
    const user = userEvent.setup();
    mockFetch({ ok: false, status: 403 });
    renderPage();

    await selectFile(user, new File(["hello"], "report.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: /upload and publish/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to finish the upload/i);
    expect(finalizeArtifact).not.toHaveBeenCalled();
  });

  it("treats a 409 reissue as completion, not failure — the artifact was finalized elsewhere after the page loaded", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ ok: true });
    // The page rendered while pending, but the agent's own curl (or a second tab) finished the
    // upload in the meantime — the backend 409s the re-mint rather than reopening write access.
    // Retrying could never succeed, so the page must not say "try again"; it goes to the artifact.
    reissueUnwrap.mockReset().mockRejectedValue({ status: 409 });
    renderPage();

    await selectFile(user, new File(["hello"], "report.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: /upload and publish/i }));

    expect(await screen.findByText("artifact detail page")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/already finished uploading/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(finalizeArtifact).not.toHaveBeenCalled();
  });

  it("shows the retryable error when the reissue fails for any other reason", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ ok: true });
    reissueUnwrap.mockReset().mockRejectedValue({ status: 500 });
    renderPage();

    await selectFile(user, new File(["hello"], "report.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: /upload and publish/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to finish the upload/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(finalizeArtifact).not.toHaveBeenCalled();
  });

  it("offers a link to the artifact instead of an upload when it has already finished", () => {
    queryResult = { data: { ...pendingArtifact, sizeBytes: 1024 }, isLoading: false };
    renderPage();

    expect(screen.getByText(/has already finished uploading/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view artifact/i })).toHaveAttribute("href", "/artifacts/a1");
    expect(screen.queryByRole("button", { name: /upload and publish/i })).not.toBeInTheDocument();
  });

  it("refuses a viewer who isn't the publisher — the link itself carries no permission", () => {
    queryResult = { data: { ...pendingArtifact, canManagePolicy: false }, isLoading: false };
    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent(/only the publisher can finish this upload/i);
    expect(screen.queryByRole("button", { name: /upload and publish/i })).not.toBeInTheDocument();
  });

  it("renders a not-found state when the artifact can't be loaded", () => {
    queryResult = { isLoading: false, error: { status: 404 } };
    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent(/artifact not found/i);
  });

  describe("agent-supplied filePath in the hash fragment", () => {
    const path = "/home/alice/reports/q3 report.pdf";
    const routeWithPath = `/artifacts/a1/complete-upload#filePath=${encodeURIComponent(path)}`;

    it("shows the path with a copy button, and copying puts it on the clipboard with an in-DOM confirmation", async () => {
      const user = userEvent.setup();
      renderPage(routeWithPath);

      expect(screen.getByText(path)).toBeInTheDocument();
      expect(screen.getByText(/paste it into the file picker/i)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /copy path/i }));

      expect(await window.navigator.clipboard.readText()).toBe(path);
      expect(screen.getByRole("status")).toHaveTextContent(/copied/i);
    });

    it("shows no path block when the link carries no fragment", () => {
      renderPage();

      expect(screen.queryByRole("button", { name: /copy path/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/paste it into the file picker/i)).not.toBeInTheDocument();
    });
  });

  describe("wrong-file check", () => {
    it("warns when the picked file's name differs from the published fileName but still allows uploading", async () => {
      const user = userEvent.setup();
      renderPage();

      await selectFile(user, new File(["hello"], "totally-different.txt", { type: "text/plain" }));

      expect(screen.getByRole("alert")).toHaveTextContent(/published as "report\.pdf"/i);
      expect(screen.getByRole("button", { name: /upload and publish/i })).toBeEnabled();
    });

    it("shows no warning when the picked file matches the published fileName", async () => {
      const user = userEvent.setup();
      renderPage();

      await selectFile(user, new File(["hello"], "report.pdf", { type: "application/pdf" }));

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});
