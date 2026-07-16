import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { PlatformLogEntry, UserCreditInfo } from "@/app/(main)/admin/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/actions/admin", () => ({
  grantStarterCredits: vi.fn(),
}));

import { UserCreditsTable, computeUserStats } from "./user-credits-table";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function log(overrides: Partial<PlatformLogEntry> = {}): PlatformLogEntry {
  return {
    user_id: "user-1",
    input_tokens: 100,
    output_tokens: 50,
    key_type: "platform",
    charged: true,
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

describe("computeUserStats", () => {
  it("counts creditsUsed only for charged rows, but platformCalls for every row", () => {
    const logs: PlatformLogEntry[] = [
      log({ charged: true }), // direct platform charge
      log({ charged: false }), // genuinely-free onboarding row
      log({ charged: true }), // upfront-charged streaming row (free:true, chargedUpfront:true)
    ];

    const stats = computeUserStats(logs);
    const userStats = stats.get("user-1");

    expect(userStats?.platformCalls).toBe(3);
    expect(userStats?.creditsUsed).toBe(2);
  });

  it("reconciles Used + Left against granted credits for a mixed fixture", () => {
    // Simulates: 10 starter credits granted, 3 genuinely charged, 2 free
    // onboarding calls (not charged) — 7 credits should remain.
    const logs: PlatformLogEntry[] = [
      log({ charged: true }),
      log({ charged: true }),
      log({ charged: true }),
      log({ charged: false }),
      log({ charged: false }),
    ];
    const creditsLeft = 7;

    const stats = computeUserStats(logs);
    const creditsUsed = stats.get("user-1")?.creditsUsed ?? 0;

    expect(creditsUsed).toBe(3);
    expect(creditsUsed + creditsLeft).toBe(10);
  });

  it("returns an empty map for no logs", () => {
    expect(computeUserStats([]).size).toBe(0);
  });
});

describe("UserCreditsTable", () => {
  it("renders 'Credits Used' from charged rows only, ignoring free rows, for a mixed fixture", () => {
    const logs: PlatformLogEntry[] = [
      log({ user_id: "user-1", charged: true }),
      log({ user_id: "user-1", charged: true }),
      log({ user_id: "user-1", charged: false }), // free onboarding row — must not count
      log({ user_id: "user-2", key_type: "byok", charged: false }), // BYOK stays unaffected
    ];
    const users: UserCreditInfo[] = [
      user({ id: "user-1", full_name: "Ada Lovelace", ai_starter_credits: 5 }),
      user({ id: "user-2", full_name: "Grace Hopper", encrypted_anthropic_key: "enc-key", ai_starter_credits: 0 }),
    ];

    render(
      <UserCreditsTable userCredits={users} allPlatformLogs={logs} isSuperAdmin={false} />
    );

    const adaRow = screen.getByText("Ada Lovelace").closest("tr");
    expect(adaRow).not.toBeNull();
    // Credits Used column (3rd data cell) should read 2, not 3.
    const cells = adaRow!.querySelectorAll("td");
    expect(cells[2].textContent).toBe("2");

    const graceRow = screen.getByText("Grace Hopper").closest("tr");
    const graceCells = graceRow!.querySelectorAll("td");
    // Grace has no platform logs in userStatsMap (her only log is BYOK-keyed
    // but recorded under key_type "byok" — platformCalls/creditsUsed both 0).
    expect(graceCells[2].textContent).toBe("0");
    expect(screen.getByText("BYOK")).toBeInTheDocument();
  });
});
