import { describe, it, expect, vi } from "vitest";
import { cappedSupabase } from "@/test/capped-supabase";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

// Board one has 1,045 cards, all newer than the single card on board two. A read
// that stops at 1,000 newest-first rows never reaches board two's card.
const tasks = Array.from({ length: 1045 }, (_, i) => ({
  id: `t${String(i).padStart(4, "0")}`,
  idea_id: "idea-1",
  updated_at: "2026-11-01T00:00:00Z",
}));
tasks.push({ id: "z", idea_id: "idea-2", updated_at: "2026-02-01T00:00:00Z" });
const same = "2026-01-01T00:00:00Z";

const { client, requests } = cappedSupabase({
  ideas: [
    { id: "idea-1", title: "One", updated_at: same, author_id: "u1", status: "open" },
    { id: "idea-2", title: "Two", updated_at: same, author_id: "u1", status: "open" },
  ],
  collaborators: [],
  board_columns: [{ idea_id: "idea-1" }, { idea_id: "idea-2" }],
  board_tasks: tasks,
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    ...client,
    from: client.from.bind(client),
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  }),
}));

import { getUserRecentBoards } from "./board";

describe("getUserRecentBoards on a board with more than 1,000 cards", () => {
  it("pages the card read instead of stopping at 1,000", async () => {
    const boards = await getUserRecentBoards();
    expect(boards.find((b) => b.ideaId === "idea-2")?.lastActivity).toBe("2026-02-01T00:00:00Z");
    expect(requests.filter((r) => r.table === "board_tasks").length).toBeGreaterThan(1);
  });
});
