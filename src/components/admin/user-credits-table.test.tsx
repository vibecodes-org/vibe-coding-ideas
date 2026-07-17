import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { PlatformStatsEntry, UserCreditInfo } from "@/app/(main)/admin/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/actions/admin", () => ({
  grantStarterCredits: vi.fn(),
}));

import { UserCreditsTable, indexPlatformStats } from "./user-credits-table";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function statsRow(overrides: Partial<PlatformStatsEntry> = {}): PlatformStatsEntry {
  return {
    user_id: "user-1",
    platform_calls: 3,
    platform_input_tokens: 300,
    platform_output_tokens: 150,
    credits_used: 2,
    ...overrides,
  };
}

function user(overrides: Partial<UserCreditInfo> = {}): UserCreditInfo {
  return {
    id: "user-1",
    full_name: "Ada Lovelace",
    email: "ada@example.com",
    avatar_url: null,
    ai_starter_credits: 7,
    encrypted_anthropic_key: null,
    ...overrides,
  };
}

describe("indexPlatformStats", () => {
  it("maps each pre-aggregated RPC row into a UserStats entry keyed by user id", () => {
    const rows: PlatformStatsEntry[] = [
      statsRow({ user_id: "user-1", platform_calls: 3, platform_input_tokens: 300, platform_output_tokens: 150, credits_used: 2 }),
      statsRow({ user_id: "user-2", platform_calls: 1, platform_input_tokens: 100, platform_output_tokens: 50, credits_used: 0 }),
    ];

    const stats = indexPlatformStats(rows);

    expect(stats.get("user-1")).toEqual({
      platformCalls: 3,
      platformInputTokens: 300,
      platformOutputTokens: 150,
      creditsUsed: 2,
    });
    expect(stats.get("user-2")).toEqual({
      platformCalls: 1,
      platformInputTokens: 100,
      platformOutputTokens: 50,
      creditsUsed: 0,
    });
  });

  it("reconciles Used + Left against granted credits for a mixed fixture", () => {
    // Simulates: 10 starter credits granted, 3 genuinely charged (2 free
    // onboarding calls already excluded server-side) — 7 credits should remain.
    const row = statsRow({ credits_used: 3 });
    const creditsLeft = 7;

    const stats = indexPlatformStats([row]);
    const creditsUsed = stats.get("user-1")?.creditsUsed ?? 0;

    expect(creditsUsed).toBe(3);
    expect(creditsUsed + creditsLeft).toBe(10);
  });

  it("returns an empty map for no rows", () => {
    expect(indexPlatformStats([]).size).toBe(0);
  });
});

describe("UserCreditsTable", () => {
  it("renders 'Credits Used' from the pre-aggregated stats row for a mixed fixture", () => {
    const rows: PlatformStatsEntry[] = [
      statsRow({ user_id: "user-1", platform_calls: 3, credits_used: 2 }), // 1 free onboarding row already excluded server-side
      statsRow({ user_id: "user-2", platform_calls: 0, platform_input_tokens: 0, platform_output_tokens: 0, credits_used: 0 }), // BYOK user has no platform rows
    ];
    const users: UserCreditInfo[] = [
      user({ id: "user-1", full_name: "Ada Lovelace", ai_starter_credits: 5 }),
      user({ id: "user-2", full_name: "Grace Hopper", encrypted_anthropic_key: "enc-key", ai_starter_credits: 0 }),
    ];

    render(
      <UserCreditsTable userCredits={users} platformStats={rows} isSuperAdmin={false} />
    );

    const adaRow = screen.getByText("Ada Lovelace").closest("tr");
    expect(adaRow).not.toBeNull();
    // Credits Used column (3rd data cell) should read 2, not 3.
    const cells = adaRow!.querySelectorAll("td");
    expect(cells[2].textContent).toBe("2");

    const graceRow = screen.getByText("Grace Hopper").closest("tr");
    const graceCells = graceRow!.querySelectorAll("td");
    expect(graceCells[2].textContent).toBe("0");
    expect(screen.getByText("BYOK")).toBeInTheDocument();
  });
});
