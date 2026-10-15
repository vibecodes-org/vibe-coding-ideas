// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  BACKUP_REASON,
  PLATFORM_OWNER_ID,
  apply,
  dryRun,
  formatReport,
  parseCliArgs,
  planRow,
  restore,
  showPlatformAgent,
  verify,
  type AgentRow,
  type BackupRow,
  type ConversionStore,
  type NewBackup,
} from "./agent-layout-conversion";

const OWNER = "11111111-1111-4111-a111-111111111111";
const STRANGER = "22222222-2222-4222-a222-222222222222";

const SECRET = "ZEBRA-MARKER-PROMPT-WORDS";
const MARKDOWN_LEGACY = `## Goal\nReview every change. ${SECRET} Catch bugs early.\n\n## Expertise\n- Rank feedback by severity.\n\n## Constraints\nNever approve unread diffs.\n\n## Approach\nRead the PR first.`;
const INLINE_LEGACY = "You are a Developer. Ship clean code. Keep PRs small.\n\nDomain expertise: Know the stack.\n\nYou must not: Skip tests.\n\nYour approach: Write tests first.";
const NEW_LAYOUT = "You plan.\n\n## Your job\nRead the card.";
const NEITHER = "First paragraph.\n\nSecond paragraph with no headings.";

type Row = AgentRow & { name: string | null };

function agent(id: string, owner: string, role: string | null, prompt: string | null, updated = "2026-10-01T00:00:00Z"): Row {
  return { id, owner_id: owner, name: `name-${id}`, role, system_prompt: prompt, updated_at: updated };
}

/** In-memory store with compare-and-set on updated_at, like the real one. */
class MemoryStore implements ConversionStore {
  agents: Row[];
  backups: (BackupRow & { name: string | null; role: string | null; reason: string })[] = [];
  clock = 0;
  /** Runs just before each setPrompt, to simulate someone editing mid-run. */
  beforeSet?: (id: string) => void;

  constructor(agents: Row[], snapshot = true) {
    this.agents = agents.map((a) => ({ ...a }));
    if (snapshot) {
      for (const a of this.agents) {
        this.backups.push({ bot_id: a.id, name: a.name, role: a.role, system_prompt: a.system_prompt, reason: BACKUP_REASON, backed_up_at: this.tick() });
      }
    }
  }
  tick() {
    this.clock += 1;
    return `2026-10-02T00:00:${String(this.clock).padStart(2, "0")}Z`;
  }
  async listAgents() {
    return this.agents.map((a) => ({ ...a }));
  }
  async listBackups(reason: string) {
    return this.backups.filter((b) => b.reason === reason).map((b) => ({ ...b }));
  }
  async insertBackup(b: NewBackup) {
    this.backups.push({ ...b, backed_up_at: this.tick() });
  }
  async setPrompt(id: string, systemPrompt: string | null, expected: string) {
    this.beforeSet?.(id);
    const a = this.agents.find((x) => x.id === id)!;
    if (a.updated_at !== expected) return false;
    a.system_prompt = systemPrompt;
    a.updated_at = this.tick();
    return true;
  }
  text(id: string) {
    return this.agents.find((x) => x.id === id)!.system_prompt;
  }
}

function fixtures() {
  return [
    agent("a1", PLATFORM_OWNER_ID, "Code Reviewer", MARKDOWN_LEGACY),
    agent("a2", OWNER, "Developer", INLINE_LEGACY),
    agent("a3", STRANGER, "Planner", NEW_LAYOUT),
    agent("a4", STRANGER, "Planner", NEITHER),
    agent("a5", STRANGER, "Planner", ""),
    agent("a6", STRANGER, "Reviewer", "## Goal\nReview.\n\n## Approach\nBe kind."),
  ];
}

describe("planRow", () => {
  it("classifies each layout and converts only old ones", () => {
    const status = (r: Row) => planRow(r).report.status;
    expect(status(fixtures()[0])).toBe("convert");
    expect(status(fixtures()[1])).toBe("convert");
    expect(status(fixtures()[2])).toBe("already-new");
    expect(status(fixtures()[3])).toBe("left-alone");
    expect(status(fixtures()[4])).toBe("empty");
  });

  it("reports owner group and lengths, never text", () => {
    const planned = planRow(fixtures()[0], { ownerId: OWNER });
    expect(planned.report.group).toBe("platform");
    expect(planned.report.oldLength).toBe(MARKDOWN_LEGACY.length);
    expect(JSON.stringify(planned.report)).not.toContain(SECRET);
    expect(planRow(fixtures()[1], { ownerId: OWNER }).report.group).toBe("owner");
    expect(planRow(fixtures()[2], { ownerId: OWNER }).report.group).toBe("other");
  });
});

describe("dryRun", () => {
  it("counts without writing anything", async () => {
    const store = new MemoryStore(fixtures());
    const before = JSON.stringify(store.agents);
    const report = await dryRun(store, { ownerId: OWNER });

    expect(JSON.stringify(store.agents)).toBe(before);
    expect(store.backups).toHaveLength(6);
    expect(report.total).toBe(6);
    expect(report.counts).toMatchObject({ convert: 3, "already-new": 1, "left-alone": 1, empty: 1 });
    expect(report.byGroupAndLayout["platform/legacy"]).toBe(1);
    expect(report.byGroupAndLayout["owner/legacy"]).toBe(1);
  });
});

describe("apply", () => {
  it("converts old-layout agents, leaves the rest exactly as they are, and is re-runnable", async () => {
    const store = new MemoryStore(fixtures());
    const first = await apply(store);

    expect(first.counts.converted).toBe(3);
    expect(store.text("a1")).toContain("## Your job");
    expect(store.text("a1")).not.toContain("## Goal");
    expect(store.text("a3")).toBe(NEW_LAYOUT);
    expect(store.text("a4")).toBe(NEITHER);
    expect(store.text("a5")).toBe("");

    const second = await apply(store);
    expect(second.counts.converted ?? 0).toBe(0);
    expect(second.counts["already-new"]).toBe(4);
  });

  it("refuses to run without the 00186 snapshot", async () => {
    const store = new MemoryStore(fixtures(), false);
    await expect(apply(store)).rejects.toThrow(/apply migration 00186 first/);
    expect(store.text("a1")).toBe(MARKDOWN_LEGACY);
  });

  it("skips an agent edited while the job ran, instead of overwriting it", async () => {
    const store = new MemoryStore(fixtures());
    store.beforeSet = (id) => {
      if (id !== "a2") return;
      const a = store.agents.find((x) => x.id === id)!;
      a.system_prompt = "edited by its owner";
      a.updated_at = "2026-10-03T00:00:00Z";
    };
    const report = await apply(store);

    expect(store.text("a2")).toBe("edited by its owner");
    expect(report.counts["skipped-edited"]).toBe(1);
    expect(report.counts.converted).toBe(2);
  });

  it("takes a fresh backup of an agent whose text changed after the snapshot", async () => {
    const store = new MemoryStore(fixtures());
    const a1 = store.agents.find((x) => x.id === "a1")!;
    const edited = `${MARKDOWN_LEGACY}\n\nExtra approach line added later.`.replace("Read the PR first.", "Read the PR first. Extra.");
    a1.system_prompt = edited;
    a1.updated_at = "2026-10-01T12:00:00Z";
    await apply(store);

    const mine = store.backups.filter((b) => b.bot_id === "a1");
    expect(mine).toHaveLength(2);
    expect(mine[mine.length - 1].system_prompt).toBe(edited);
  });

  it("does not add a second backup when the snapshot already holds the current text", async () => {
    const store = new MemoryStore(fixtures());
    await apply(store);
    expect(store.backups.filter((b) => b.bot_id === "a1")).toHaveLength(1);
  });

  it("treats an old-layout prompt that already contains a new-layout heading as new, and leaves it alone", async () => {
    const tricky = "## Goal\nDo x. Then y.\n\n## Approach\nSteps:\n## What not to do\nstuff";
    const store = new MemoryStore([agent("x1", STRANGER, "Reviewer", tricky), ...fixtures()]);
    const report = await apply(store);

    expect(store.text("x1")).toBe(tricky);
    expect(report.rows.find((r) => r.id === "x1")?.status).toBe("already-new");
    expect(report.counts.converted).toBe(3);
  });
});

describe("verify", () => {
  it("passes after apply, and reports nothing still in the old layout", async () => {
    const store = new MemoryStore(fixtures());
    await apply(store);
    const report = await verify(store);

    expect(report.counts.converted).toBe(3);
    expect(report.counts.failed ?? 0).toBe(0);
  });

  it("flags an old-layout agent that was never converted", async () => {
    const store = new MemoryStore(fixtures());
    const report = await verify(store);

    expect(report.counts.failed).toBe(3);
    expect(report.rows.find((r) => r.id === "a1")?.reason).toBe("still in the old layout");
  });

  it("does not judge an agent edited after the conversion", async () => {
    const store = new MemoryStore(fixtures());
    await apply(store);
    const a1 = store.agents.find((x) => x.id === "a1")!;
    a1.system_prompt = `${a1.system_prompt}\n\nAdded afterwards.`;
    const report = await verify(store);

    expect(report.rows.find((r) => r.id === "a1")?.status).toBe("skipped-edited");
    expect(report.counts.failed ?? 0).toBe(0);
  });
});

describe("restore", () => {
  it("puts back converted agents exactly, and leaves untouched and edited agents alone", async () => {
    const store = new MemoryStore(fixtures());
    await apply(store);
    const a2 = store.agents.find((x) => x.id === "a2")!;
    a2.system_prompt = `${a2.system_prompt}\n\nEdited by the owner afterwards.`;
    const edited = a2.system_prompt;

    const report = await restore(store);

    expect(store.text("a1")).toBe(MARKDOWN_LEGACY);
    expect(store.text("a6")).toBe("## Goal\nReview.\n\n## Approach\nBe kind.");
    expect(store.text("a2")).toBe(edited);
    expect(store.text("a3")).toBe(NEW_LAYOUT);
    expect(report.counts.restored).toBe(2);
  });

  it("uses the latest backup when an agent was backed up twice", async () => {
    const store = new MemoryStore(fixtures());
    const a1 = store.agents.find((x) => x.id === "a1")!;
    const newer = MARKDOWN_LEGACY.replace("Read the PR first.", "Read the PR first. Then the tests.");
    a1.system_prompt = newer;
    a1.updated_at = "2026-10-01T12:00:00Z";
    await apply(store);
    await restore(store);

    expect(store.text("a1")).toBe(newer);
  });

  it("skips a row changed while the job ran", async () => {
    const store = new MemoryStore(fixtures());
    await apply(store);
    store.beforeSet = (id) => {
      const a = store.agents.find((x) => x.id === id)!;
      a.updated_at = "2026-10-09T00:00:00Z";
    };
    const report = await restore(store);

    expect(report.counts.restored ?? 0).toBe(0);
    expect(store.text("a1")).toContain("## Your job");
  });
});

describe("formatReport (public-repo rule)", () => {
  it("prints ids, groups, lengths and counts, and never prompt text or names", async () => {
    const store = new MemoryStore(fixtures());
    const lines = formatReport(await dryRun(store, { ownerId: OWNER })).join("\n");

    expect(lines).toContain("mode: dry-run");
    expect(lines).toContain("convert: 3");
    expect(lines).not.toContain(SECRET);
    expect(lines).not.toContain("Never approve unread diffs");
    expect(lines).not.toContain("name-a1");
  });

  it("lists failures by id only", async () => {
    const store = new MemoryStore(fixtures());
    const lines = formatReport(await verify(store)).join("\n");
    expect(lines).toMatch(/failed a1 \[platform, legacy, \d+ chars\]: still in the old layout/);
    expect(lines).not.toContain(SECRET);
  });
});

describe("parseCliArgs", () => {
  it("defaults to a dry run", () => {
    expect(parseCliArgs([])).toEqual({ mode: "dry-run", confirm: null, show: null, ownerId: null });
  });

  it("requires the confirm word for apply and restore", () => {
    expect(() => parseCliArgs(["--mode", "apply"])).toThrow("apply needs --confirm CONVERT");
    expect(() => parseCliArgs(["--mode", "apply", "--confirm", "yes"])).toThrow("apply needs --confirm CONVERT");
    expect(parseCliArgs(["--mode", "apply", "--confirm", "CONVERT"]).mode).toBe("apply");
    expect(() => parseCliArgs(["--mode", "restore", "--confirm", "CONVERT"])).toThrow("restore needs --confirm RESTORE");
    expect(parseCliArgs(["--mode", "restore", "--confirm", "RESTORE"]).mode).toBe("restore");
  });

  it("does not ask for confirmation when only showing a platform agent", () => {
    expect(parseCliArgs(["--mode", "apply", "--show", "a1"]).show).toBe("a1");
  });

  it("rejects unknown modes, options and missing values", () => {
    expect(() => parseCliArgs(["--mode", "wipe"])).toThrow("--mode must be one of");
    expect(() => parseCliArgs(["--force", "1"])).toThrow("Unknown option: --force");
    expect(() => parseCliArgs(["--mode"])).toThrow("--mode needs a value");
    expect(() => parseCliArgs(["apply"])).toThrow("Unexpected argument: apply");
  });
});

describe("showPlatformAgent", () => {
  it("shows a platform agent's before and after text", async () => {
    const store = new MemoryStore(fixtures());
    const shown = await showPlatformAgent(store, "a1");
    expect(shown.before).toBe(MARKDOWN_LEGACY);
    expect(shown.after).toContain("## Your job");
  });

  it("refuses every other owner's agent, so private prompts are never printed", async () => {
    const store = new MemoryStore(fixtures());
    await expect(showPlatformAgent(store, "a2")).rejects.toThrow("--show only works for platform-owned agents");
    await expect(showPlatformAgent(store, "a3")).rejects.toThrow("--show only works");
  });

  it("reports a missing id", async () => {
    await expect(showPlatformAgent(new MemoryStore(fixtures()), "nope")).rejects.toThrow("No agent with id nope");
  });
});
