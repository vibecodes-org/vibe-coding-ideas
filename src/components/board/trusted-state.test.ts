import { describe, it, expect } from "vitest";
import { mergeTrustedState, TRUST_WINDOW_MS, type TrustedTaskState } from "./trusted-state";

type Task = { id: string; position: number };
type Col = { id: string; tasks: Task[] };

const cols = (...defs: [string, Task[]][]): Col[] => defs.map(([id, tasks]) => ({ id, tasks }));
const trust = (entries: Record<string, TrustedTaskState>) =>
  new Map<string, TrustedTaskState>(Object.entries(entries));

const NOW = 1_000_000;
const live = { trustedUntil: NOW + TRUST_WINDOW_MS };

describe("mergeTrustedState", () => {
  it("returns the same reference when there are no trusted entries", () => {
    const server = cols(["a", [{ id: "t1", position: 0 }]]);
    const res = mergeTrustedState(server, new Map(), NOW);
    expect(res.columns).toBe(server);
    expect(res.resolved).toEqual([]);
  });

  it("overrides the server when it disagrees on the task's column (the bounce)", () => {
    // Server (stale replica) still shows t1 in A; we trust it in B.
    const server = cols(["a", [{ id: "t1", position: 0 }]], ["b", []]);
    const res = mergeTrustedState(
      server,
      trust({ t1: { columnId: "b", position: 1000, ...live } }),
      NOW
    );
    const a = res.columns.find((c) => c.id === "a")!;
    const b = res.columns.find((c) => c.id === "b")!;
    expect(a.tasks.map((t) => t.id)).toEqual([]);
    expect(b.tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(b.tasks[0].position).toBe(1000);
    expect(res.resolved).toEqual([]);
  });

  it("drops the entry (resolved) and does not override when the server already agrees", () => {
    const server = cols(["b", [{ id: "t1", position: 1000 }]]);
    const res = mergeTrustedState(
      server,
      trust({ t1: { columnId: "b", position: 1000, ...live } }),
      NOW
    );
    expect(res.columns).toBe(server); // no override → identity preserved
    expect(res.resolved).toEqual(["t1"]);
  });

  it("overrides when the column matches but the position differs", () => {
    const server = cols(["b", [{ id: "t1", position: 0 }]]);
    const res = mergeTrustedState(
      server,
      trust({ t1: { columnId: "b", position: 2000, ...live } }),
      NOW
    );
    expect(res.columns.find((c) => c.id === "b")!.tasks[0].position).toBe(2000);
    expect(res.resolved).toEqual([]);
  });

  it("inserts the trusted task in position-sorted order", () => {
    const server = cols(
      ["a", [{ id: "t1", position: 0 }]],
      ["b", [{ id: "x", position: 0 }, { id: "y", position: 2000 }]]
    );
    const res = mergeTrustedState(
      server,
      trust({ t1: { columnId: "b", position: 1000, ...live } }),
      NOW
    );
    expect(res.columns.find((c) => c.id === "b")!.tasks.map((t) => t.id)).toEqual(["x", "t1", "y"]);
  });

  it("drops an expired entry without overriding", () => {
    const server = cols(["a", [{ id: "t1", position: 0 }]], ["b", []]);
    const res = mergeTrustedState(
      server,
      trust({ t1: { columnId: "b", position: 0, trustedUntil: NOW - 1 } }),
      NOW
    );
    expect(res.columns).toBe(server);
    expect(res.resolved).toEqual(["t1"]);
  });

  it("drops an entry whose task no longer exists (archived/deleted)", () => {
    const server = cols(["a", [{ id: "other", position: 0 }]]);
    const res = mergeTrustedState(
      server,
      trust({ gone: { columnId: "b", position: 0, ...live } }),
      NOW
    );
    expect(res.columns).toBe(server);
    expect(res.resolved).toEqual(["gone"]);
  });

  it("handles concurrent trusted moves into different columns", () => {
    const server = cols(
      ["a", [{ id: "t1", position: 0 }, { id: "t2", position: 1000 }]],
      ["b", []],
      ["c", []]
    );
    const res = mergeTrustedState(
      server,
      trust({
        t1: { columnId: "b", position: 0, ...live },
        t2: { columnId: "c", position: 0, ...live },
      }),
      NOW
    );
    expect(res.columns.find((c) => c.id === "a")!.tasks).toEqual([]);
    expect(res.columns.find((c) => c.id === "b")!.tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(res.columns.find((c) => c.id === "c")!.tasks.map((t) => t.id)).toEqual(["t2"]);
  });

  it("handles a same-column reorder override", () => {
    const server = cols(["a", [{ id: "t1", position: 0 }, { id: "t2", position: 1000 }]]);
    // We moved t1 to the end (position 2000) but the stale server still has it first.
    const res = mergeTrustedState(
      server,
      trust({ t1: { columnId: "a", position: 2000, ...live } }),
      NOW
    );
    expect(res.columns.find((c) => c.id === "a")!.tasks.map((t) => t.id)).toEqual(["t2", "t1"]);
  });

  it("suppresses a trusted-removed task the stale server still shows (archive/delete)", () => {
    // Server (lagging replica) still has t1; we archived/deleted it locally.
    const server = cols(["a", [{ id: "t1", position: 0 }, { id: "t2", position: 1000 }]]);
    const res = mergeTrustedState(
      server,
      trust({ t1: { columnId: "", position: 0, removed: true, ...live } }),
      NOW
    );
    expect(res.columns.find((c) => c.id === "a")!.tasks.map((t) => t.id)).toEqual(["t2"]);
    expect(res.resolved).toEqual([]);
  });

  it("resolves a trusted removal once the server has dropped the task too", () => {
    const server = cols(["a", [{ id: "t2", position: 1000 }]]); // t1 gone server-side
    const res = mergeTrustedState(
      server,
      trust({ t1: { columnId: "", position: 0, removed: true, ...live } }),
      NOW
    );
    expect(res.columns).toBe(server); // nothing to suppress → identity preserved
    expect(res.resolved).toEqual(["t1"]);
  });

  it("resolves a trusted removal when the window expires (server then wins)", () => {
    const server = cols(["a", [{ id: "t1", position: 0 }]]);
    const res = mergeTrustedState(
      server,
      trust({ t1: { columnId: "", position: 0, removed: true, trustedUntil: NOW - 1 } }),
      NOW
    );
    expect(res.columns).toBe(server);
    expect(res.resolved).toEqual(["t1"]);
  });

  it("does not mutate the input columns or tasks", () => {
    const server = cols(["a", [{ id: "t1", position: 0 }]], ["b", []]);
    const snapshot = JSON.stringify(server);
    mergeTrustedState(server, trust({ t1: { columnId: "b", position: 0, ...live } }), NOW);
    expect(JSON.stringify(server)).toBe(snapshot);
  });

  it("preserves other task fields when overriding (spreads the original)", () => {
    const server = [
      { id: "a", tasks: [{ id: "t1", position: 0, title: "Keep me" }] },
      { id: "b", tasks: [] as { id: string; position: number; title: string }[] },
    ];
    const res = mergeTrustedState(
      server,
      trust({ t1: { columnId: "b", position: 5, ...live } }),
      NOW
    );
    const moved = res.columns.find((c) => c.id === "b")!.tasks[0];
    expect(moved.title).toBe("Keep me");
    expect(moved.position).toBe(5);
  });
});
