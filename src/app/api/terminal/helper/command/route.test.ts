// Card 6b2cb8ac: "Update now" / "Download the helper" closed whichever Mac's
// helper held the account's single control slot. The command now carries
// this Mac's names so the relay delivers it only to this Mac's helper leg.
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

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/terminal/helper/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("TERMINAL_SESSION_SECRET", "test-secret");
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ delivered: true }) });
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function sentBody() {
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

describe("POST /api/terminal/helper/command", () => {
  it("forwards this Mac's names to the relay", async () => {
    const res = await POST(req({ cmd: "quiesce", machines: ["Nicks-Mac-mini.local"] }));
    expect(res.status).toBe(200);
    expect(sentBody()).toEqual({ cmd: "quiesce", machines: ["Nicks-Mac-mini.local"] });
  });

  it("set-always-on keeps its value and carries machines", async () => {
    await POST(req({ cmd: "set-always-on", value: true, machines: ["a"] }));
    expect(sentBody()).toEqual({ cmd: "set-always-on", value: true, machines: ["a"] });
  });

  it("without machines the body is unchanged (old behaviour)", async () => {
    await POST(req({ cmd: "stop" }));
    expect(sentBody()).toEqual({ cmd: "stop" });
  });

  it("rejects more than 5 names, or a name over 200 characters", async () => {
    expect((await POST(req({ cmd: "stop", machines: ["a", "b", "c", "d", "e", "f"] }))).status).toBe(400);
    expect((await POST(req({ cmd: "stop", machines: ["x".repeat(201)] }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
