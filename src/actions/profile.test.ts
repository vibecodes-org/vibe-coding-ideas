import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Minimal Supabase client mock
// ---------------------------------------------------------------------------

const mockSupabase = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Import after mocks are set up
import {
  getModelTierMap,
  updateModelTierMap,
  getAgentAwareModelTierMap,
  updateAgentAwareModelTierMap,
  getTerminalModel,
  updateTerminalModel,
  getTerminalAutoAccept,
  updateTerminalAutoAccept,
} from "./profile";
import { MACHINE_DEFAULT_TERMINAL_MODEL } from "@/lib/terminal/model-resolution";

const FAKE_USER_ID = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: FAKE_USER_ID } }, error: null });
});

describe("getModelTierMap", () => {
  it("returns the stored map for the authenticated user", async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { model_tier_map: { frontier: "opus" } }, error: null }),
        }),
      }),
    }));

    const result = await getModelTierMap();
    expect(result).toEqual({ frontier: "opus" });
  });

  it("returns null when the column is null", async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { model_tier_map: null }, error: null }),
        }),
      }),
    }));

    const result = await getModelTierMap();
    expect(result).toBeNull();
  });

  it("throws when not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(getModelTierMap()).rejects.toThrow("Not authenticated");
  });

  it("propagates DB errors", async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: { message: "connection lost" } }),
        }),
      }),
    }));
    await expect(getModelTierMap()).rejects.toThrow("connection lost");
  });
});

describe("updateModelTierMap", () => {
  it("accepts a valid partial map and stores it scoped to the current user", async () => {
    let updatedWith: unknown;
    let scopedTo: unknown;
    mockSupabase.from.mockImplementation(() => ({
      update: (data: unknown) => ({
        eq: (col: string, val: unknown) => {
          updatedWith = data;
          scopedTo = { [col]: val };
          return Promise.resolve({ error: null });
        },
      }),
    }));

    const result = await updateModelTierMap({ frontier: "opus", cheap: "haiku" });

    expect(result).toEqual({ frontier: "opus", cheap: "haiku" });
    expect(updatedWith).toEqual({ model_tier_map: { frontier: "opus", cheap: "haiku" } });
    expect(scopedTo).toEqual({ id: FAKE_USER_ID });
  });

  it("accepts every valid tier/model combination", async () => {
    mockSupabase.from.mockImplementation(() => ({
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }));

    await expect(
      updateModelTierMap({ frontier: "fable", standard: "sonnet", cheap: "haiku" })
    ).resolves.toEqual({ frontier: "fable", standard: "sonnet", cheap: "haiku" });
  });

  it("stores NULL for an empty map (all tiers reset to platform default)", async () => {
    let updatedWith: unknown;
    mockSupabase.from.mockImplementation(() => ({
      update: (data: unknown) => {
        updatedWith = data;
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }));

    const result = await updateModelTierMap({});

    expect(result).toBeNull();
    expect(updatedWith).toEqual({ model_tier_map: null });
  });

  it("rejects an unknown key", async () => {
    await expect(
      updateModelTierMap({ nonsense: "opus" } as never)
    ).rejects.toThrow("Invalid model tier map");
  });

  it("rejects an invalid model value", async () => {
    await expect(
      updateModelTierMap({ frontier: "gpt-4" } as never)
    ).rejects.toThrow("Invalid model tier map");
  });

  it("rejects a non-object payload", async () => {
    await expect(updateModelTierMap("opus" as never)).rejects.toThrow("Invalid model tier map");
    await expect(updateModelTierMap(null as never)).rejects.toThrow("Invalid model tier map");
    await expect(updateModelTierMap(["opus"] as never)).rejects.toThrow("Invalid model tier map");
  });

  it("throws when not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(updateModelTierMap({ frontier: "opus" })).rejects.toThrow("Not authenticated");
  });

  it("propagates DB errors", async () => {
    mockSupabase.from.mockImplementation(() => ({
      update: () => ({ eq: () => Promise.resolve({ error: { message: "write failed" } }) }),
    }));
    await expect(updateModelTierMap({ frontier: "opus" })).rejects.toThrow("write failed");
  });
});

describe("getAgentAwareModelTierMap", () => {
  it("upgrades a legacy flat row to the agent-aware shape (Claude-only, no stored effort)", async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { model_tier_map: { frontier: "opus" } }, error: null }),
        }),
      }),
    }));

    const result = await getAgentAwareModelTierMap();
    expect(result).toEqual({ frontier: { claude: { model: "opus" } } });
  });

  it("passes an already agent-aware row through unchanged", async () => {
    const stored = { frontier: { claude: { model: "opus", effort: "high" }, codex: { model: "gpt-5.1-codex", effort: "high" } } };
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: { model_tier_map: stored }, error: null }) }),
      }),
    }));

    expect(await getAgentAwareModelTierMap()).toEqual(stored);
  });

  it("returns {} when the column is null", async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { model_tier_map: null }, error: null }) }) }),
    }));

    expect(await getAgentAwareModelTierMap()).toEqual({});
  });

  it("throws when not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(getAgentAwareModelTierMap()).rejects.toThrow("Not authenticated");
  });
});

describe("updateAgentAwareModelTierMap", () => {
  it("accepts a valid Claude override (model + effort) and stores it scoped to the current user", async () => {
    let updatedWith: unknown;
    mockSupabase.from.mockImplementation(() => ({
      update: (data: unknown) => {
        updatedWith = data;
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }));

    const result = await updateAgentAwareModelTierMap({ frontier: { claude: { model: "opus", effort: "high" } } });

    expect(result).toEqual({ frontier: { claude: { model: "opus", effort: "high" } } });
    expect(updatedWith).toEqual({ model_tier_map: { frontier: { claude: { model: "opus", effort: "high" } } } });
  });

  it("accepts a valid Codex override on the same tier", async () => {
    mockSupabase.from.mockImplementation(() => ({
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }));

    await expect(
      updateAgentAwareModelTierMap({ standard: { codex: { model: "gpt-5.1-codex-mini", effort: "medium" } } })
    ).resolves.toEqual({ standard: { codex: { model: "gpt-5.1-codex-mini", effort: "medium" } } });
  });

  it("stores NULL for an empty map (all tiers reset to platform default)", async () => {
    let updatedWith: unknown;
    mockSupabase.from.mockImplementation(() => ({
      update: (data: unknown) => {
        updatedWith = data;
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }));

    const result = await updateAgentAwareModelTierMap({});

    expect(result).toBeNull();
    expect(updatedWith).toEqual({ model_tier_map: null });
  });

  it("rejects a model chosen with no effort (AC-3), naming the tier and agent", async () => {
    await expect(
      updateAgentAwareModelTierMap({ frontier: { codex: { model: "gpt-5.1-codex" } } })
    ).rejects.toThrow(/Choose a reasoning effort for gpt-5.1-codex — Frontier \(Codex\)/);
  });

  it("rejects an invalid Claude alias", async () => {
    await expect(
      updateAgentAwareModelTierMap({ frontier: { claude: { model: "gpt-4", effort: "high" } } })
    ).rejects.toThrow(/must be one of/);
  });

  it("rejects a Codex model id containing shell metacharacters (FR-1)", async () => {
    await expect(
      updateAgentAwareModelTierMap({ frontier: { codex: { model: "gpt; rm -rf", effort: "high" } } })
    ).rejects.toThrow();
  });

  it("rejects a non-object payload", async () => {
    await expect(updateAgentAwareModelTierMap("opus" as never)).rejects.toThrow("Invalid model tier map");
    await expect(updateAgentAwareModelTierMap(null as never)).rejects.toThrow("Invalid model tier map");
  });

  it("throws when not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(updateAgentAwareModelTierMap({})).rejects.toThrow("Not authenticated");
  });

  it("propagates DB errors", async () => {
    mockSupabase.from.mockImplementation(() => ({
      update: () => ({ eq: () => Promise.resolve({ error: { message: "write failed" } }) }),
    }));
    await expect(updateAgentAwareModelTierMap({ frontier: { claude: { model: "opus", effort: "high" } } })).rejects.toThrow(
      "write failed"
    );
  });
});

describe("getTerminalModel", () => {
  it("returns the stored override for the authenticated user", async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { terminal_model: "sonnet" }, error: null }),
        }),
      }),
    }));

    expect(await getTerminalModel()).toBe("sonnet");
  });

  it("returns null when the column is null (no override)", async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { terminal_model: null }, error: null }),
        }),
      }),
    }));

    expect(await getTerminalModel()).toBeNull();
  });

  it("throws when not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(getTerminalModel()).rejects.toThrow("Not authenticated");
  });

  it("propagates DB errors", async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: { message: "connection lost" } }),
        }),
      }),
    }));
    await expect(getTerminalModel()).rejects.toThrow("connection lost");
  });
});

describe("updateTerminalModel", () => {
  it("accepts a valid known alias and stores it scoped to the current user", async () => {
    let updatedWith: unknown;
    let scopedTo: unknown;
    mockSupabase.from.mockImplementation(() => ({
      update: (data: unknown) => ({
        eq: (col: string, val: unknown) => {
          updatedWith = data;
          scopedTo = { [col]: val };
          return Promise.resolve({ error: null });
        },
      }),
    }));

    const result = await updateTerminalModel("sonnet");

    expect(result).toBe("sonnet");
    expect(updatedWith).toEqual({ terminal_model: "sonnet" });
    expect(scopedTo).toEqual({ id: FAKE_USER_ID });
  });

  it("accepts a novel/custom model id — no schema change needed (AC-12)", async () => {
    mockSupabase.from.mockImplementation(() => ({
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }));
    await expect(updateTerminalModel("claude-opus-5-20260101")).resolves.toBe("claude-opus-5-20260101");
  });

  it("accepts the machine-default sentinel verbatim, bypassing structural validation", async () => {
    let updatedWith: unknown;
    mockSupabase.from.mockImplementation(() => ({
      update: (data: unknown) => {
        updatedWith = data;
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }));

    const result = await updateTerminalModel(MACHINE_DEFAULT_TERMINAL_MODEL);

    expect(result).toBe(MACHINE_DEFAULT_TERMINAL_MODEL);
    expect(updatedWith).toEqual({ terminal_model: MACHINE_DEFAULT_TERMINAL_MODEL });
  });

  it("stores NULL to clear the override back to the platform default (AC-6)", async () => {
    let updatedWith: unknown;
    mockSupabase.from.mockImplementation(() => ({
      update: (data: unknown) => {
        updatedWith = data;
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }));

    const result = await updateTerminalModel(null);

    expect(result).toBeNull();
    expect(updatedWith).toEqual({ terminal_model: null });
  });

  it("rejects an empty/whitespace-only value (AC-12)", async () => {
    await expect(updateTerminalModel("   ")).rejects.toThrow(/model name/i);
  });

  it("rejects a value containing shell metacharacters (AC-12)", async () => {
    await expect(updateTerminalModel("opus; rm -rf")).rejects.toThrow();
    await expect(updateTerminalModel("opus 5!")).rejects.toThrow(/space/i);
  });

  it("rejects a value over the 100-char cap before ever touching the DB (QA Bug 1)", async () => {
    await expect(updateTerminalModel("a".repeat(101))).rejects.toThrow(/100 characters/i);
  });

  it("boundary: exactly 100 chars is accepted, 101 is rejected (QA Bug 1)", async () => {
    mockSupabase.from.mockImplementation(() => ({
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }));
    await expect(updateTerminalModel("a".repeat(100))).resolves.toBe("a".repeat(100));
    await expect(updateTerminalModel("a".repeat(101))).rejects.toThrow(/100 characters/i);
  });

  it("throws when not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(updateTerminalModel("opus")).rejects.toThrow("Not authenticated");
  });

  it("propagates DB errors", async () => {
    mockSupabase.from.mockImplementation(() => ({
      update: () => ({ eq: () => Promise.resolve({ error: { message: "write failed" } }) }),
    }));
    await expect(updateTerminalModel("opus")).rejects.toThrow("write failed");
  });
});

describe("getTerminalAutoAccept (task d3de150c)", () => {
  it("returns the stored preference for the authenticated user", async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { terminal_auto_accept: true }, error: null }),
        }),
      }),
    }));

    expect(await getTerminalAutoAccept()).toBe(true);
  });

  it("returns false when unset (default off)", async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { terminal_auto_accept: false }, error: null }),
        }),
      }),
    }));

    expect(await getTerminalAutoAccept()).toBe(false);
  });

  it("throws when not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(getTerminalAutoAccept()).rejects.toThrow("Not authenticated");
  });

  it("propagates DB errors", async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: { message: "connection lost" } }),
        }),
      }),
    }));
    await expect(getTerminalAutoAccept()).rejects.toThrow("connection lost");
  });
});

describe("updateTerminalAutoAccept (task d3de150c)", () => {
  it("stores true scoped to the current user", async () => {
    let updatedWith: unknown;
    let scopedTo: unknown;
    mockSupabase.from.mockImplementation(() => ({
      update: (data: unknown) => ({
        eq: (col: string, val: unknown) => {
          updatedWith = data;
          scopedTo = { [col]: val };
          return Promise.resolve({ error: null });
        },
      }),
    }));

    const result = await updateTerminalAutoAccept(true);

    expect(result).toBe(true);
    expect(updatedWith).toEqual({ terminal_auto_accept: true });
    expect(scopedTo).toEqual({ id: FAKE_USER_ID });
  });

  it("stores false", async () => {
    let updatedWith: unknown;
    mockSupabase.from.mockImplementation(() => ({
      update: (data: unknown) => {
        updatedWith = data;
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }));

    await expect(updateTerminalAutoAccept(false)).resolves.toBe(false);
    expect(updatedWith).toEqual({ terminal_auto_accept: false });
  });

  it("throws when not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(updateTerminalAutoAccept(true)).rejects.toThrow("Not authenticated");
  });

  it("propagates DB errors", async () => {
    mockSupabase.from.mockImplementation(() => ({
      update: () => ({ eq: () => Promise.resolve({ error: { message: "write failed" } }) }),
    }));
    await expect(updateTerminalAutoAccept(true)).rejects.toThrow("write failed");
  });
});
