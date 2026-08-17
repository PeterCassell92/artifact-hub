import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import type { ArtifactDetail, CreateArtifactResponse } from "contracts";
import { makeStore } from "../store/store";
import { NotificationRegion } from "./NotificationRegion";

const createUnwrap = jest.fn<() => Promise<CreateArtifactResponse>>();
const createArtifact = jest.fn(() => ({ unwrap: createUnwrap }));
const finalizeUnwrap = jest.fn<() => Promise<ArtifactDetail>>();
const finalizeArtifact = jest.fn(() => ({ unwrap: finalizeUnwrap }));
const onClose = jest.fn();

jest.unstable_mockModule("../store/api", () => ({
  useCreateArtifactMutation: () => [createArtifact, { isLoading: false }],
  useFinalizeArtifactMutation: () => [finalizeArtifact, { isLoading: false }],
  useListGroupsQuery: () => ({ data: [] }),
  useListUsersQuery: () => ({ data: [{ id: "user-1", email: "reviewer@test.local", name: null }] }),
}));

const { PublishArtifactModal } = await import("./PublishArtifactModal");

function renderModal() {
  return render(
    <Provider store={makeStore()}>
      <NotificationRegion />
      <PublishArtifactModal open onClose={onClose} />
    </Provider>,
  );
}

function makeFile(name = "report.pdf", type = "application/pdf", content = "hello world") {
  return new File([content], name, { type });
}

// jsdom doesn't define `fetch`, so there's nothing for `jest.spyOn(global, "fetch")` to spy on.
function mockFetch(response: Partial<Response>) {
  const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(response as Response);
  global.fetch = fetchMock;
  return fetchMock;
}

async function selectFileAndAdvance(user: ReturnType<typeof userEvent.setup>, file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);
  await user.click(screen.getByRole("button", { name: /next/i }));
}

describe("PublishArtifactModal", () => {
  beforeEach(() => {
    onClose.mockClear();
    createArtifact.mockClear();
    createUnwrap.mockReset().mockResolvedValue({
      artifactId: "artifact-1",
      uploadUrl: "https://storage.test/artifacts/artifact-1/report.pdf",
    });
    finalizeArtifact.mockClear();
    finalizeUnwrap.mockReset().mockResolvedValue({} as ArtifactDetail);
    mockFetch({ ok: true });
  });

  afterEach(() => {
    delete (global as { fetch?: typeof fetch }).fetch;
  });

  it("step 1: shows the empty-state tile when no file is selected, Next disabled", () => {
    renderModal();

    expect(screen.getByText(/choose a file to upload/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("step 1: switches to the metadata view and enables Next once a file is selected", async () => {
    renderModal();
    const user = userEvent.setup();
    const file = makeFile();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText(/application\/pdf/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).toBeEnabled();
  });

  it("step 2: blocks Publish and shows inline feedback until an audience is actually set", async () => {
    renderModal();
    const user = userEvent.setup();
    await selectFileAndAdvance(user, makeFile());

    expect(screen.getByLabelText(/audience/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^publish$/i }));

    expect(screen.getByText(/select at least one person/i)).toBeInTheDocument();
    expect(createArtifact).not.toHaveBeenCalled();
  });

  it("Back returns to the file step without losing the selected file", async () => {
    renderModal();
    const user = userEvent.setup();
    await selectFileAndAdvance(user, makeFile());

    await user.click(screen.getByRole("button", { name: /back/i }));

    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("publishes with the chosen policy: creates the artifact, PUTs the bytes, finalizes, notifies, and closes", async () => {
    renderModal();
    const user = userEvent.setup();
    await selectFileAndAdvance(user, makeFile());

    await user.selectOptions(screen.getByLabelText(/audience/i), "public_authenticated");
    await user.click(screen.getByRole("button", { name: /^publish$/i }));

    expect(createArtifact).toHaveBeenCalledWith({
      title: "report.pdf",
      fileName: "report.pdf",
      contentType: "application/pdf",
      audienceType: "public_authenticated",
      expiry: "never",
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://storage.test/artifacts/artifact-1/report.pdf",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(finalizeArtifact).toHaveBeenCalledWith({ artifactId: "artifact-1" });
    expect(await screen.findByText(/published "report\.pdf"/i)).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it("publishes with specific_users selected via the checkbox combo box, no free text", async () => {
    renderModal();
    const user = userEvent.setup();
    await selectFileAndAdvance(user, makeFile());

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /reviewer@test\.local/i }));
    await user.click(screen.getByRole("button", { name: /^publish$/i }));

    expect(createArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ audienceType: "specific_users", userEmails: ["reviewer@test.local"] }),
    );
  });

  it("keeps the modal open and shows an error notification if the upload PUT fails", async () => {
    mockFetch({ ok: false });
    renderModal();
    const user = userEvent.setup();
    await selectFileAndAdvance(user, makeFile());

    await user.selectOptions(screen.getByLabelText(/audience/i), "public_authenticated");
    await user.click(screen.getByRole("button", { name: /^publish$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to publish/i);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^publish$/i })).toBeEnabled();
  });
});
