import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import type { ArtifactDetail, CreateArtifactResponse } from "contracts";
import { makeStore } from "../store/store";
import { NotificationRegion } from "./NotificationRegion";
import type { RelationshipDraft } from "./RelationshipPicker";

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

// RelationshipPicker's own search/select behavior is covered by RelationshipPicker.test.tsx —
// stub it here so these tests stay focused on the modal's own step navigation and submit payload.
jest.unstable_mockModule("./RelationshipPicker", () => ({
  RelationshipPicker: ({ onAdd }: { onAdd: (draft: RelationshipDraft) => void }) => (
    <button
      type="button"
      onClick={() => onAdd({ toId: "artifact-9", toTitle: "Source diagram", type: "derived_from", note: "export" })}
    >
      Stub add relationship
    </button>
  ),
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

// jsdom derives `size` from the actual Blob content, so a real 500MB+ File would mean allocating
// 500MB in every test run — override the getter instead to exercise the boundary cheaply.
function makeFileWithSize(size: number, name = "huge.bin", type = "application/octet-stream") {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

// jsdom doesn't define `fetch`, so there's nothing for `jest.spyOn(global, "fetch")` to spy on.
function mockFetch(response: Partial<Response>) {
  const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(response as Response);
  global.fetch = fetchMock;
  return fetchMock;
}

async function selectFile(user: ReturnType<typeof userEvent.setup>, file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);
}

async function advanceToMetadata(user: ReturnType<typeof userEvent.setup>, file: File) {
  await selectFile(user, file);
  await user.click(screen.getByRole("button", { name: /next/i }));
}

async function advanceToPolicy(user: ReturnType<typeof userEvent.setup>, file: File) {
  await advanceToMetadata(user, file);
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

  it("step 1: shows the file preview and enables Next once a file is selected", async () => {
    renderModal();
    const user = userEvent.setup();
    const file = makeFile();

    await selectFile(user, file);

    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText(/application\/pdf/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).toBeEnabled();
  });

  it("step 1: rejects a file over the 500MB cap with an inline error, Next stays disabled", async () => {
    renderModal();
    const user = userEvent.setup();

    await selectFile(user, makeFileWithSize(500 * 1024 * 1024 + 1));

    expect(screen.getByRole("alert")).toHaveTextContent(/500\.0 MB/i);
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
    expect(createArtifact).not.toHaveBeenCalled();
  });

  it("step 2 (metadata): pre-fills the name and an inferred kind from the file, and always allows Next", async () => {
    renderModal();
    const user = userEvent.setup();
    await advanceToMetadata(user, makeFile());

    expect(screen.getByText(/step 2 of 3/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toHaveValue("report.pdf");
    expect(screen.getByLabelText(/^file type$/i)).toHaveTextContent("PDF");
    expect(screen.getByLabelText(/^kind$/i)).toHaveValue("document");
    expect(screen.getByLabelText(/^language$/i)).toHaveValue("en");
    expect(screen.getByRole("button", { name: /next/i })).toBeEnabled();
  });

  it("step 2 (metadata): keeps auto-inferring kind from the file until the publisher edits it manually", async () => {
    renderModal();
    const user = userEvent.setup();
    await advanceToMetadata(user, makeFile("photo.png", "image/png"));
    expect(screen.getByLabelText(/^kind$/i)).toHaveValue("image");

    // Re-picking a file (still on the metadata step's underlying file state) keeps inferring...
    await user.click(screen.getByRole("button", { name: /back/i }));
    await selectFile(user, makeFile("data.json", "application/json"));
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByLabelText(/^kind$/i)).toHaveValue("data");

    // ...but once the publisher picks a kind themselves, further file changes stop overriding it.
    await user.selectOptions(screen.getByLabelText(/^kind$/i), "report");
    await user.click(screen.getByRole("button", { name: /back/i }));
    await selectFile(user, makeFile("photo.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByLabelText(/^kind$/i)).toHaveValue("report");
  });

  it("step 2 (metadata): lets the publisher rename the artifact and add/remove tags", async () => {
    renderModal();
    const user = userEvent.setup();
    await advanceToMetadata(user, makeFile());

    await user.clear(screen.getByLabelText(/^name$/i));
    await user.type(screen.getByLabelText(/^name$/i), "Q3 report");
    await user.type(screen.getByLabelText(/tags/i), "roadmap{enter}");

    expect(screen.getByText("roadmap")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /remove tag roadmap/i }));
    expect(screen.queryByText("roadmap")).not.toBeInTheDocument();
  });

  it("step 2 (metadata): staging a relationship shows it and lets it be removed before publish", async () => {
    renderModal();
    const user = userEvent.setup();
    await advanceToMetadata(user, makeFile());

    await user.click(screen.getByRole("button", { name: /stub add relationship/i }));
    expect(screen.getByText("Source diagram")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /remove relationship to source diagram/i }));
    expect(screen.queryByText("Source diagram")).not.toBeInTheDocument();
  });

  it("step 3 (policy): blocks Publish and shows inline feedback until an audience is actually set", async () => {
    renderModal();
    const user = userEvent.setup();
    await advanceToPolicy(user, makeFile());

    expect(screen.getByLabelText(/audience/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^publish$/i }));

    expect(screen.getByText(/select at least one person/i)).toBeInTheDocument();
    expect(createArtifact).not.toHaveBeenCalled();
  });

  it("Back steps go metadata -> file and policy -> metadata without losing state", async () => {
    renderModal();
    const user = userEvent.setup();
    await advanceToPolicy(user, makeFile());

    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByText(/step 2 of 3/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByText(/step 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("publishes with the chosen metadata and policy: creates the artifact, PUTs the bytes, finalizes, notifies, and closes", async () => {
    renderModal();
    const user = userEvent.setup();
    await advanceToMetadata(user, makeFile());
    await user.click(screen.getByRole("button", { name: /stub add relationship/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));

    await user.selectOptions(screen.getByLabelText(/audience/i), "public_authenticated");
    await user.click(screen.getByRole("button", { name: /^publish$/i }));

    expect(createArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "report.pdf",
        fileName: "report.pdf",
        contentType: "application/pdf",
        kind: "document",
        sourceTool: "frontendSPA",
        language: "en",
        audienceType: "public_authenticated",
        expiry: "never",
        relationships: [{ toId: "artifact-9", type: "derived_from", note: "export" }],
      }),
    );
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
    await advanceToPolicy(user, makeFile());

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
    await advanceToPolicy(user, makeFile());

    await user.selectOptions(screen.getByLabelText(/audience/i), "public_authenticated");
    await user.click(screen.getByRole("button", { name: /^publish$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to publish/i);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^publish$/i })).toBeEnabled();
  });
});
