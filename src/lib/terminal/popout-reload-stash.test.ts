import { describe, it, expect } from "vitest";
import {
  parsePopoutStash,
  savePopoutStash,
  loadPopoutStash,
  clearPopoutStash,
  type PopoutStash,
} from "./popout-reload-stash";

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

const STASH: PopoutStash = {
  sid: "sid-1",
  label: "fix-login-bug",
  identity: "Nick's MacBook · session sid-1",
  readOnly: false,
  autoAccept: false,
  ideaId: "idea-1",
  ideaTitle: "VibeCodes",
};

describe("parsePopoutStash", () => {
  it("parses a valid stash", () => {
    expect(parsePopoutStash(JSON.stringify(STASH))).toEqual(STASH);
  });

  it("returns null for null/empty/malformed/incomplete input", () => {
    expect(parsePopoutStash(null)).toBeNull();
    expect(parsePopoutStash(undefined)).toBeNull();
    expect(parsePopoutStash("")).toBeNull();
    expect(parsePopoutStash("not json")).toBeNull();
    expect(parsePopoutStash(JSON.stringify({ sid: "sid-1" }))).toBeNull();
  });

  // ── auto-accept mode (task d3de150c) ──────────────────────────────────────

  it("parses autoAccept: true when present", () => {
    const withAutoAccept = { ...STASH, autoAccept: true };
    expect(parsePopoutStash(JSON.stringify(withAutoAccept))).toEqual(withAutoAccept);
  });

  it("deploy skew: a stash saved before this field existed defaults autoAccept to false, not rejected", () => {
    const { autoAccept: _autoAccept, ...legacyStash } = STASH;
    const parsed = parsePopoutStash(JSON.stringify(legacyStash));
    expect(parsed).not.toBeNull();
    expect(parsed?.autoAccept).toBe(false);
  });

  it("a wrong-typed autoAccept field is coerced to false rather than rejecting the whole stash", () => {
    const parsed = parsePopoutStash(JSON.stringify({ ...STASH, autoAccept: "true" }));
    expect(parsed).not.toBeNull();
    expect(parsed?.autoAccept).toBe(false);
  });
});

describe("savePopoutStash / loadPopoutStash / clearPopoutStash", () => {
  it("round-trips", () => {
    const storage = new FakeStorage();
    savePopoutStash(STASH, storage);
    expect(loadPopoutStash(storage)).toEqual(STASH);
  });

  it("loading with nothing saved returns null", () => {
    expect(loadPopoutStash(new FakeStorage())).toBeNull();
  });

  it("a later save overwrites the earlier one (one flat key)", () => {
    const storage = new FakeStorage();
    savePopoutStash(STASH, storage);
    const next = { ...STASH, sid: "sid-2" };
    savePopoutStash(next, storage);
    expect(loadPopoutStash(storage)).toEqual(next);
  });

  it("clear removes the stash", () => {
    const storage = new FakeStorage();
    savePopoutStash(STASH, storage);
    clearPopoutStash(storage);
    expect(loadPopoutStash(storage)).toBeNull();
  });

  it("null storage is a silent no-op everywhere", () => {
    expect(() => savePopoutStash(STASH, null)).not.toThrow();
    expect(loadPopoutStash(null)).toBeNull();
    expect(() => clearPopoutStash(null)).not.toThrow();
  });
});
