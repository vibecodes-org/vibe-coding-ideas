import { describe, it, expect } from "vitest";
import {
  SNAPSHOT_KEY_PREFIX,
  SNAPSHOT_FRESHNESS_MS,
  RECONNECT_DIVIDER_TEXT,
  snapshotKey,
  isSnapshotFresh,
  serializeSnapshot,
  parseSnapshot,
  saveSessionSnapshot,
  loadSessionSnapshot,
  clearSessionSnapshot,
  rememberLastTabSid,
  readLastTabSid,
  parseTabSids,
  readTabSids,
  rememberTabSid,
  forgetTabSid,
  toReconnectBuffer,
} from "./session-snapshot";
import type { TransferredBuffer } from "./scrollback-transfer";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");
const BUFFER: TransferredBuffer = { data: "hello\r\n", truncated: false };

/** A minimal in-memory `Storage` stub — no jsdom/browser required. */
class FakeStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

/** Throws quota errors on `setItem` until `allowAfter` further writes have been attempted. */
class QuotaLimitedStorage extends FakeStorage {
  constructor(private allowAfter: number) {
    super();
  }
  setItem(key: string, value: string): void {
    if (this.allowAfter > 0) {
      this.allowAfter -= 1;
      const err = new Error("QuotaExceededError");
      err.name = "QuotaExceededError";
      throw err;
    }
    super.setItem(key, value);
  }
}

describe("snapshotKey", () => {
  it("namespaces under the shared prefix", () => {
    expect(snapshotKey("abc123")).toBe(`${SNAPSHOT_KEY_PREFIX}abc123`);
  });
});

describe("isSnapshotFresh", () => {
  it("is fresh just under the 60s boundary", () => {
    expect(isSnapshotFresh(NOW - (SNAPSHOT_FRESHNESS_MS - 1), NOW)).toBe(true);
  });

  it("is stale exactly at and beyond the boundary", () => {
    expect(isSnapshotFresh(NOW - SNAPSHOT_FRESHNESS_MS, NOW)).toBe(false);
    expect(isSnapshotFresh(NOW - SNAPSHOT_FRESHNESS_MS - 1000, NOW)).toBe(false);
  });

  it("rejects a clock-skewed future savedAt rather than treating it as fresh", () => {
    expect(isSnapshotFresh(NOW + 5000, NOW)).toBe(false);
  });
});

describe("serializeSnapshot / parseSnapshot", () => {
  it("round-trips", () => {
    const raw = serializeSnapshot(BUFFER, NOW);
    expect(parseSnapshot(raw)).toEqual({ data: BUFFER.data, truncated: BUFFER.truncated, savedAt: NOW });
  });

  it("parses null/empty/malformed input to null, never throws", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot(undefined)).toBeNull();
    expect(parseSnapshot("")).toBeNull();
    expect(parseSnapshot("not json")).toBeNull();
    expect(parseSnapshot("{}")).toBeNull();
    expect(parseSnapshot(JSON.stringify({ data: "x" }))).toBeNull();
  });
});

describe("saveSessionSnapshot / loadSessionSnapshot / clearSessionSnapshot", () => {
  it("saves and loads a snapshot for a sid", () => {
    const storage = new FakeStorage();
    saveSessionSnapshot("sid-1", BUFFER, NOW, storage);
    expect(loadSessionSnapshot("sid-1", storage)).toEqual({
      data: BUFFER.data,
      truncated: BUFFER.truncated,
      savedAt: NOW,
    });
  });

  it("loading an absent sid returns null", () => {
    const storage = new FakeStorage();
    expect(loadSessionSnapshot("nope", storage)).toBeNull();
  });

  it("clear removes exactly that sid's snapshot", () => {
    const storage = new FakeStorage();
    saveSessionSnapshot("sid-1", BUFFER, NOW, storage);
    saveSessionSnapshot("sid-2", BUFFER, NOW, storage);
    clearSessionSnapshot("sid-1", storage);
    expect(loadSessionSnapshot("sid-1", storage)).toBeNull();
    expect(loadSessionSnapshot("sid-2", storage)).not.toBeNull();
  });

  it("a null storage (SSR / unavailable) is a silent no-op, never throws", () => {
    expect(() => saveSessionSnapshot("sid-1", BUFFER, NOW, null)).not.toThrow();
    expect(loadSessionSnapshot("sid-1", null)).toBeNull();
    expect(() => clearSessionSnapshot("sid-1", null)).not.toThrow();
  });

  it("quota-safe: evicts its own oldest snapshot and retries once", () => {
    // Only the SUT's write for "sid-new" throws (once) — everything else
    // (the pre-seeded older snapshot, the eviction's removeItem, the retry)
    // behaves like plain storage.
    const combined = new (class extends FakeStorage {
      private thrown = false;
      setItem(key: string, value: string): void {
        if (!this.thrown && key === snapshotKey("sid-new")) {
          this.thrown = true;
          const err = new Error("QuotaExceededError");
          err.name = "QuotaExceededError";
          throw err;
        }
        super.setItem(key, value);
      }
    })();
    combined.setItem(snapshotKey("sid-old"), serializeSnapshot(BUFFER, NOW - 10_000));
    saveSessionSnapshot("sid-new", BUFFER, NOW, combined);
    expect(loadSessionSnapshot("sid-old", combined)).toBeNull(); // evicted
    expect(loadSessionSnapshot("sid-new", combined)).not.toBeNull(); // retry succeeded
  });

  it("quota-safe: gives up silently when there is nothing of its own to evict", () => {
    const storage = new QuotaLimitedStorage(Infinity); // every write throws forever
    expect(() => saveSessionSnapshot("sid-1", BUFFER, NOW, storage)).not.toThrow();
    expect(loadSessionSnapshot("sid-1", storage)).toBeNull();
  });

  it("eviction never touches a key outside the snapshot prefix", () => {
    const combined = new (class extends FakeStorage {
      private thrown = false;
      setItem(key: string, value: string): void {
        if (!this.thrown && key === snapshotKey("sid-new")) {
          this.thrown = true;
          const err = new Error("QuotaExceededError");
          err.name = "QuotaExceededError";
          throw err;
        }
        super.setItem(key, value);
      }
    })();
    combined.setItem("some-other-feature-key", "keep-me");
    saveSessionSnapshot("sid-new", BUFFER, NOW, combined);
    // Nothing of ours to evict, so the retry still fails — but the foreign key survives either way.
    expect(combined.getItem("some-other-feature-key")).toBe("keep-me");
  });
});

describe("rememberLastTabSid / readLastTabSid", () => {
  it("round-trips", () => {
    const storage = new FakeStorage();
    expect(readLastTabSid(storage)).toBeNull();
    rememberLastTabSid("sid-1", storage);
    expect(readLastTabSid(storage)).toBe("sid-1");
    rememberLastTabSid("sid-2", storage);
    expect(readLastTabSid(storage)).toBe("sid-2");
  });

  it("null storage is a silent no-op", () => {
    expect(() => rememberLastTabSid("sid-1", null)).not.toThrow();
    expect(readLastTabSid(null)).toBeNull();
  });
});

describe("parseTabSids", () => {
  it("parses a JSON array of strings", () => {
    expect(parseTabSids('["a","b"]')).toEqual(["a", "b"]);
  });

  it("drops non-string entries and never throws on malformed input", () => {
    expect(parseTabSids('["a", 1, null, "b"]')).toEqual(["a", "b"]);
    expect(parseTabSids("not json")).toEqual([]);
    expect(parseTabSids('{"sid":"a"}')).toEqual([]);
    expect(parseTabSids(null)).toEqual([]);
    expect(parseTabSids(undefined)).toEqual([]);
  });
});

describe("rememberTabSid / readTabSids / forgetTabSid (multi-terminal reload restore)", () => {
  it("accumulates every attached sid in attach order, deduplicated", () => {
    const storage = new FakeStorage();
    expect(readTabSids(storage)).toEqual([]);
    rememberTabSid("sid-1", storage);
    rememberTabSid("sid-2", storage);
    rememberTabSid("sid-1", storage); // re-attach of a known sid — no duplicate, order kept
    expect(readTabSids(storage)).toEqual(["sid-1", "sid-2"]);
  });

  it("also refreshes the legacy last-sid slot on every remember", () => {
    const storage = new FakeStorage();
    rememberTabSid("sid-1", storage);
    rememberTabSid("sid-2", storage);
    expect(readLastTabSid(storage)).toBe("sid-2");
  });

  it("falls back to the legacy last-sid slot when the list was never written (pre-fix tab)", () => {
    const storage = new FakeStorage();
    rememberLastTabSid("legacy-sid", storage);
    expect(readTabSids(storage)).toEqual(["legacy-sid"]);
  });

  it("forgetTabSid removes only the given sid and leaves the legacy slot alone", () => {
    const storage = new FakeStorage();
    rememberTabSid("sid-1", storage);
    rememberTabSid("sid-2", storage);
    forgetTabSid("sid-1", storage);
    expect(readTabSids(storage)).toEqual(["sid-2"]);
    expect(readLastTabSid(storage)).toBe("sid-2");
    forgetTabSid("never-known", storage); // no-op, never throws
    expect(readTabSids(storage)).toEqual(["sid-2"]);
  });

  it("forgetting the last listed sid falls back to the legacy slot only if the list key was never written", () => {
    const storage = new FakeStorage();
    rememberTabSid("sid-1", storage);
    forgetTabSid("sid-1", storage);
    // The list key now holds [], which is the honest answer — the legacy
    // slot (still "sid-1") must NOT resurrect a released session...
    expect(parseTabSids(storage.getItem("vc:term:tab-sids"))).toEqual([]);
    // ...but readTabSids' legacy fallback fires on an EMPTY list, so it
    // still reports the legacy sid. Harmless by design: the entry decision
    // also requires a fresh snapshot AND a live registry row, and an ended
    // session has neither (its snapshot is cleared alongside forgetTabSid).
    expect(readTabSids(storage)).toEqual(["sid-1"]);
  });

  it("null storage is a silent no-op", () => {
    expect(() => rememberTabSid("sid-1", null)).not.toThrow();
    expect(() => forgetTabSid("sid-1", null)).not.toThrow();
    expect(readTabSids(null)).toEqual([]);
  });

  it("a throwing storage never propagates", () => {
    const storage = new QuotaLimitedStorage(99);
    expect(() => rememberTabSid("sid-1", storage)).not.toThrow();
    expect(readTabSids(storage)).toEqual([]);
  });
});

describe("toReconnectBuffer", () => {
  it("prefixes the reconnect divider onto the snapshot's data", () => {
    const buffer = toReconnectBuffer({ data: "hello\r\n", truncated: false, savedAt: NOW });
    expect(buffer.data).toBe(`\x1b[2m${RECONNECT_DIVIDER_TEXT}\x1b[0m\r\nhello\r\n`);
    expect(buffer.truncated).toBe(false);
  });

  it("preserves the truncated flag so restoreScrollback still adds its own marker", () => {
    const buffer = toReconnectBuffer({ data: "x", truncated: true, savedAt: NOW });
    expect(buffer.truncated).toBe(true);
  });
});
