// Unit tests for serializeScrollback/restoreScrollback (card 35cffc10).
//
// `@xterm/addon-serialize`'s real `SerializeAddon.activate(terminal)` reaches
// into a real xterm `Terminal`'s internal buffer service — it has nothing to
// read on a plain stub object and would just throw immediately, which the
// module's own try/catch would silently swallow into the "internal failure"
// fallback for EVERY test, defeating the point of testing the cap/truncation
// logic at all. So this file mocks the addon module itself with a small fake
// `SerializeAddon` whose `serialize({ scrollback })` returns a deterministic
// string sized off the STUB terminal's `buffer.active.length` (captured via
// `activate`, exactly like the real addon would) — enough to drive the
// halving loop through real, observable inputs without a DOM or a real xterm
// instance, matching how popout-channel.ts tests a stub channel instead of a
// real BroadcastChannel.
//
// Shared mutable knobs live in `vi.hoisted()` (Vitest's supported way to hand
// state to a hoisted `vi.mock` factory) so individual tests can drive
// pathological addon behaviour — always-oversized output, throwing on a
// given call — without a separate `vi.mock` per test.

import { describe, it, expect, vi, beforeEach } from "vitest";

const BYTES_PER_LINE = 100;
const CAP_BYTES = 1_048_576; // mirrors SCROLLBACK_TRANSFER_CAP_BYTES — literal, see note below

const fakeAddonState = vi.hoisted(() => ({
  forceOversizedBytes: null as number | null,
  throwOnCallNumber: null as number | null,
  serializeCallCount: 0,
  disposeCallCount: 0,
  loadAddonCallCount: 0,
}));

vi.mock("@xterm/addon-serialize", () => {
  class FakeSerializeAddon {
    private term: { buffer: { active: { length: number } } } | null = null;
    activate(term: { buffer: { active: { length: number } } }) {
      this.term = term;
    }
    dispose() {
      fakeAddonState.disposeCallCount += 1;
    }
    serialize(options?: { scrollback?: number }): string {
      fakeAddonState.serializeCallCount += 1;
      if (
        fakeAddonState.throwOnCallNumber !== null &&
        fakeAddonState.serializeCallCount === fakeAddonState.throwOnCallNumber
      ) {
        throw new Error("serialize exploded");
      }
      if (fakeAddonState.forceOversizedBytes !== null) {
        return "x".repeat(fakeAddonState.forceOversizedBytes);
      }
      const total = this.term?.buffer.active.length ?? 0;
      const rows = options?.scrollback === undefined ? total : Math.min(options.scrollback, total);
      return "x".repeat(Math.max(0, rows) * BYTES_PER_LINE);
    }
  }
  return { SerializeAddon: FakeSerializeAddon };
});

const {
  serializeScrollback,
  restoreScrollback,
  SCROLLBACK_TRANSFER_CAP_BYTES,
  SCROLLBACK_TRUNCATION_MARKER_TEXT,
} = await import("./scrollback-transfer");

// The mocked cap must match the real export — pinned once so a future change
// to the real constant can't silently desync this file's own CAP_BYTES.
if (CAP_BYTES !== SCROLLBACK_TRANSFER_CAP_BYTES) {
  throw new Error("test file's CAP_BYTES is out of sync with SCROLLBACK_TRANSFER_CAP_BYTES");
}

beforeEach(() => {
  fakeAddonState.forceOversizedBytes = null;
  fakeAddonState.throwOnCallNumber = null;
  fakeAddonState.serializeCallCount = 0;
  fakeAddonState.disposeCallCount = 0;
  fakeAddonState.loadAddonCallCount = 0;
});

// A minimal stub satisfying ScrollbackCapableTerminal — records every call so
// tests can assert both the RESULT and the SEQUENCE of operations (order
// matters for restoreScrollback's reset-before-write contract).
function makeStubTerminal(totalLines: number) {
  const calls: string[] = [];
  return {
    calls,
    // Method-shorthand parameter type (not an arrow-typed property) so this
    // structurally satisfies ScrollbackCapableTerminal.loadAddon under
    // strictFunctionTypes — see popout-channel.ts's PopoutChannelLike doc for
    // the same distinction (method params are bivariant, property-typed
    // function params are contravariant).
    loadAddon(addon: { activate(term: unknown): void }) {
      calls.push("loadAddon");
      fakeAddonState.loadAddonCallCount += 1;
      addon.activate(this);
    },
    reset() {
      calls.push("reset");
    },
    write(data: string) {
      calls.push(`write:${data}`);
    },
    buffer: { active: { length: totalLines } },
  };
}

describe("serializeScrollback", () => {
  it("returns the full serialize untruncated when it's under the cap", () => {
    const term = makeStubTerminal(10); // 10 * 100 bytes = 1,000 bytes, well under 1 MiB
    const result = serializeScrollback(term, SCROLLBACK_TRANSFER_CAP_BYTES);
    expect(result.truncated).toBe(false);
    expect(result.data.length).toBe(1000);
  });

  it("truncates oldest-first by halving scrollback row counts when over the cap", () => {
    // 20,000 lines * 100 bytes/line = 2,000,000 bytes — over the 1 MiB (1,048,576) cap.
    const term = makeStubTerminal(20_000);
    const result = serializeScrollback(term, SCROLLBACK_TRANSFER_CAP_BYTES);
    expect(result.truncated).toBe(true);
    expect(new TextEncoder().encode(result.data).length).toBeLessThanOrEqual(SCROLLBACK_TRANSFER_CAP_BYTES);
    // Halving is whole-row: the result length is always an exact multiple of
    // one line's byte size, never a byte-offset slice mid-row.
    expect(result.data.length % BYTES_PER_LINE).toBe(0);
    // More than one serialize() call proves the halving loop actually ran
    // (not just a single oversized attempt accepted as-is).
    expect(fakeAddonState.serializeCallCount).toBeGreaterThan(1);
  });

  it("respects a custom cap", () => {
    const term = makeStubTerminal(1000); // 100,000 bytes untruncated
    const result = serializeScrollback(term, 10_000);
    expect(result.truncated).toBe(true);
    expect(new TextEncoder().encode(result.data).length).toBeLessThanOrEqual(10_000);
  });

  it("the truncation loop is bounded even when the addon NEVER shrinks below the cap", () => {
    // A pathological addon that always returns an oversized string no matter
    // how far `scrollback` is halved — this must still terminate (never
    // hang) rather than loop forever chasing a cap it can't satisfy.
    fakeAddonState.forceOversizedBytes = SCROLLBACK_TRANSFER_CAP_BYTES * 2;
    const term = makeStubTerminal(20_000); // ~15 halvings to reach 0
    const result = serializeScrollback(term, SCROLLBACK_TRANSFER_CAP_BYTES);
    expect(result.truncated).toBe(true);
    // Bounded: one initial full serialize + a small, finite number of
    // halving re-tries (log2(20,000) ≈ 15) — nowhere near hundreds/thousands,
    // which is what an unbounded or buggy loop would rack up.
    expect(fakeAddonState.serializeCallCount).toBeGreaterThan(1);
    expect(fakeAddonState.serializeCallCount).toBeLessThan(50);
  });

  it("never throws on a hostile terminal stub — loadAddon throws", () => {
    const term = {
      loadAddon() {
        throw new Error("boom");
      },
      reset() {},
      write() {},
      buffer: { active: { length: 10 } },
    };
    const result = serializeScrollback(term);
    expect(result).toEqual({ data: "", truncated: false });
  });

  it("never throws on a hostile terminal stub — buffer.active.length is missing/NaN", () => {
    fakeAddonState.forceOversizedBytes = SCROLLBACK_TRANSFER_CAP_BYTES * 2; // force the halving branch to run
    const term = makeStubTerminal(Number.NaN);
    expect(() => serializeScrollback(term)).not.toThrow();
    const result = serializeScrollback(term);
    // NaN total lines can't be halved meaningfully — the loop must bail out
    // (rowCount clamped to 0) rather than compute NaN row counts forever.
    expect(result.truncated).toBe(true);
  });

  it("disposes the addon even when serialize() throws mid-truncation, and still returns the safe fallback", () => {
    fakeAddonState.throwOnCallNumber = 2; // 1st call (full serialize) succeeds oversized, 2nd (first halving) throws
    fakeAddonState.forceOversizedBytes = SCROLLBACK_TRANSFER_CAP_BYTES * 2;
    const term = makeStubTerminal(20_000);
    const result = serializeScrollback(term, SCROLLBACK_TRANSFER_CAP_BYTES);
    expect(result).toEqual({ data: "", truncated: false });
    expect(fakeAddonState.disposeCallCount).toBe(1);
  });

  it("disposes the addon on the ordinary success path too", () => {
    const term = makeStubTerminal(10);
    serializeScrollback(term, SCROLLBACK_TRANSFER_CAP_BYTES);
    expect(fakeAddonState.disposeCallCount).toBe(1);
  });
});

describe("restoreScrollback", () => {
  it("resets BEFORE writing anything — pins the reset-before-write order", () => {
    const term = makeStubTerminal(0);
    restoreScrollback(term, { data: "hello", truncated: false });
    expect(term.calls[0]).toBe("reset");
    expect(term.calls).toEqual(["reset", "write:hello"]);
  });

  it("writes the dim truncation marker BEFORE the data, only when truncated", () => {
    const term = makeStubTerminal(0);
    restoreScrollback(term, { data: "payload", truncated: true });
    expect(term.calls).toEqual([
      "reset",
      `write:\x1b[2m${SCROLLBACK_TRUNCATION_MARKER_TEXT}\x1b[0m\r\n`,
      "write:payload",
    ]);
  });

  it("never writes the marker when truncated is false", () => {
    const term = makeStubTerminal(0);
    restoreScrollback(term, { data: "payload", truncated: false });
    expect(term.calls.some((c) => c.includes(SCROLLBACK_TRUNCATION_MARKER_TEXT))).toBe(false);
  });

  it("is a no-op beyond the reset on an empty, non-truncated buffer", () => {
    const term = makeStubTerminal(0);
    restoreScrollback(term, { data: "", truncated: false });
    expect(term.calls).toEqual(["reset"]);
  });

  it("still writes the marker on an empty but truncated buffer (a pathological cap-of-zero case)", () => {
    const term = makeStubTerminal(0);
    restoreScrollback(term, { data: "", truncated: true });
    expect(term.calls).toEqual(["reset", `write:\x1b[2m${SCROLLBACK_TRUNCATION_MARKER_TEXT}\x1b[0m\r\n`]);
  });

  it("never throws when reset() itself throws — the marker/data writes never even attempted", () => {
    const calls: string[] = [];
    const term = {
      reset() {
        calls.push("reset");
        throw new Error("reset boom");
      },
      write(data: string) {
        calls.push(`write:${data}`);
      },
      loadAddon() {},
      buffer: { active: { length: 0 } },
    };
    expect(() => restoreScrollback(term, { data: "x", truncated: true })).not.toThrow();
    expect(calls).toEqual(["reset"]);
  });

  it("never throws when write() throws", () => {
    const term = {
      reset() {},
      write() {
        throw new Error("write boom");
      },
      loadAddon() {},
      buffer: { active: { length: 0 } },
    };
    expect(() => restoreScrollback(term, { data: "x", truncated: false })).not.toThrow();
  });
});
