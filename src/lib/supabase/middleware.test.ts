import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The real `createServerClient` talks to Supabase over the network; middleware
// tests only care about what `updateSession` does with the { user } it gets
// back, so the client itself is mocked per-test via `mockGetUser`.
const mockGetUser = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser },
  }),
}));

import { updateSession } from "./middleware";

function makeRequest(pathname: string) {
  return new NextRequest(new URL(pathname, "http://localhost:3000"));
}

describe("updateSession", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
  });

  it("redirects a signed-out visitor to /login when requesting /settings", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await updateSession(makeRequest("/settings"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("redirect")).toBe("/settings");
  });

  it("lets a signed-in user through to /settings without redirecting", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });

    const response = await updateSession(makeRequest("/settings"));

    // NextResponse.next() carries no Location header and a 200 status.
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("does not protect an unrelated public path like /feed", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await updateSession(makeRequest("/feed"));

    expect(response.headers.get("location")).toBeNull();
  });
});
