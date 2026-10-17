// Card 6b2cb8ac: the helper status poll asks about THIS Mac's helper when
// the page knows this Mac's names (`?machines=a,b`).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGetUser } = vi.hoisted(() => ({ mockGetUser: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ auth: { getUser: () => mockGetUser() } }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../../../../../terminal/shared/session-token.mjs", () => ({
  mintControlToken: vi.fn().mockResolvedValue("control-tok"),
  helperSessionId: (sub: string) => `helper-${sub}`,
}));
vi.mock("@/lib/terminal/relay-http", () => ({ relayHttpBaseUrl: () => "http://relay.test" }));

import { GET } from "./route";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("TERMINAL_SESSION_SECRET", "test-secret");
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ connected: true }) });
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/terminal/helper/status", () => {
  it("forwards ?machines= to the relay", async () => {
    const res = await GET(
      new Request("http://localhost/api/terminal/helper/status?machines=Nicks-Mac-mini.local,nicks-mac-mini"),
    );
    expect(res.status).toBe(200);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/helper/status");
    expect(url.searchParams.get("session")).toBe("helper-user-1");
    // Sanitized (bounded, lower-cased, de-duplicated) before it's forwarded.
    expect(url.searchParams.get("machines")).toBe("nicks-mac-mini.local,nicks-mac-mini");
  });

  it("without machines asks exactly as before", async () => {
    await GET(new Request("http://localhost/api/terminal/helper/status"));
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.has("machines")).toBe(false);
  });
});
