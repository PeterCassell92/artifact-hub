import { jest } from "@jest/globals";
import { redeemShareLink } from "./shareLink";
import { setTokenGetter } from "../auth/tokenBridge";

// jsdom doesn't define `fetch`, so there's nothing for `jest.spyOn(global, "fetch")` to spy on —
// stub it directly and restore afterward.
function mockFetch(response: Partial<Response>) {
  const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(response as Response);
  global.fetch = fetchMock;
  return fetchMock;
}

describe("redeemShareLink", () => {
  afterEach(() => {
    setTokenGetter(null);
    delete (global as { fetch?: typeof fetch }).fetch;
  });

  it("asks for JSON and resolves the artifact id from the response body", async () => {
    setTokenGetter(() => Promise.resolve("test-token"));
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ artifactId: "11111111-1111-1111-1111-111111111111" }),
    } as Response);

    const result = await redeemShareLink("abc123");

    expect(result).toEqual({ ok: true, artifactId: "11111111-1111-1111-1111-111111111111" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/s/abc123");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Accept).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer test-token");
  });

  it("returns the status when the backend denies access, without reading a body", async () => {
    mockFetch({
      ok: false,
      status: 403,
      json: () => Promise.reject(new Error("should not be read")),
    } as Response);

    const result = await redeemShareLink("abc123");

    expect(result).toEqual({ ok: false, status: 403 });
  });

  // Regression guard: the old implementation followed a 302 and read the artifact id off
  // `response.url`, which broke under the Fetch spec's redirect-chain CORS tainting (see
  // shareLink.ts). The artifact id must come from the parsed JSON body, never `response.url`.
  it("ignores response.url and reads the artifact id from the JSON body", async () => {
    mockFetch({
      ok: true,
      status: 200,
      url: "http://localhost:5173/wrong-path",
      json: () => Promise.resolve({ artifactId: "22222222-2222-2222-2222-222222222222" }),
    } as Response);

    const result = await redeemShareLink("abc123");

    expect(result).toEqual({ ok: true, artifactId: "22222222-2222-2222-2222-222222222222" });
  });

  it("returns a 500 result when the response body doesn't match the expected shape", async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ unexpected: "shape" }),
    } as Response);

    const result = await redeemShareLink("abc123");

    expect(result).toEqual({ ok: false, status: 500 });
  });
});
