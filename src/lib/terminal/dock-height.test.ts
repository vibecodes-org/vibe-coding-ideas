import { describe, it, expect } from "vitest";
import {
  DOCK_HEIGHT_KEY,
  MIN_DOCK_HEIGHT_PX,
  DOCK_VIEWPORT_RESERVE_PX,
  maxDockHeight,
  clampDockHeight,
  defaultDockHeight,
  resolveDockHeight,
  dragDockHeight,
  stepDockHeight,
  writeDockHeight,
  readDockHeight,
  clearDockHeight,
} from "./dock-height";

/** Minimal in-memory `Storage` stub — mirrors dock-open-persistence.test.ts's fixture. */
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

/** Always throws — simulates quota exceeded / disabled storage / privacy mode. */
class ThrowingStorage extends FakeStorage {
  setItem(): never {
    throw new Error("QuotaExceededError");
  }
  getItem(): never {
    throw new Error("SecurityError");
  }
  removeItem(): never {
    throw new Error("QuotaExceededError");
  }
}

const VH = 1000; // a comfortable desktop viewport for most cases

describe("maxDockHeight", () => {
  it("leaves the reserve for the page above the dock", () => {
    expect(maxDockHeight(VH)).toBe(VH - DOCK_VIEWPORT_RESERVE_PX);
  });
  it("never drops below the minimum on a tiny viewport", () => {
    expect(maxDockHeight(100)).toBe(MIN_DOCK_HEIGHT_PX);
    expect(maxDockHeight(0)).toBe(MIN_DOCK_HEIGHT_PX);
  });
});

describe("clampDockHeight", () => {
  it("passes through an in-range height, rounded to whole px", () => {
    expect(clampDockHeight(400.4, VH)).toBe(400);
    expect(clampDockHeight(400.6, VH)).toBe(401);
  });
  it("floors at the minimum", () => {
    expect(clampDockHeight(10, VH)).toBe(MIN_DOCK_HEIGHT_PX);
    expect(clampDockHeight(-500, VH)).toBe(MIN_DOCK_HEIGHT_PX);
  });
  it("caps at the viewport max so the dock can never cover the whole page", () => {
    expect(clampDockHeight(5000, VH)).toBe(maxDockHeight(VH));
  });
  it("treats NaN/Infinity as 'use the default'", () => {
    expect(clampDockHeight(Number.NaN, VH)).toBe(defaultDockHeight(VH));
    expect(clampDockHeight(Number.POSITIVE_INFINITY, VH)).toBe(defaultDockHeight(VH));
  });
});

describe("defaultDockHeight", () => {
  it("is 38% of the viewport (the old h-[38vh]) on a normal desktop", () => {
    expect(defaultDockHeight(VH)).toBe(380);
  });
  it("respects the minimum on a short viewport", () => {
    // 38% of 300 = 114 < min
    expect(defaultDockHeight(300)).toBe(MIN_DOCK_HEIGHT_PX);
  });
  it("respects the max on a viewport where 38% would breach the reserve", () => {
    // Only possible when the viewport is barely bigger than min + reserve; check the invariant holds.
    const vh = MIN_DOCK_HEIGHT_PX + DOCK_VIEWPORT_RESERVE_PX + 10;
    expect(defaultDockHeight(vh)).toBeLessThanOrEqual(maxDockHeight(vh));
    expect(defaultDockHeight(vh)).toBeGreaterThanOrEqual(MIN_DOCK_HEIGHT_PX);
  });
});

describe("resolveDockHeight", () => {
  it("uses the default when nothing is stored", () => {
    expect(resolveDockHeight(null, VH)).toBe(defaultDockHeight(VH));
  });
  it("uses the stored preference when it fits the viewport", () => {
    expect(resolveDockHeight(520, VH)).toBe(520);
  });
  it("clamps a stored preference that no longer fits a smaller viewport — without losing it", () => {
    const preferred = 700;
    expect(resolveDockHeight(preferred, 600)).toBe(maxDockHeight(600));
    // Same preference, viewport grows back → the original choice is restored.
    expect(resolveDockHeight(preferred, VH)).toBe(700);
  });
});

describe("dragDockHeight", () => {
  it("dragging UP (smaller clientY) makes the bottom-docked panel taller", () => {
    expect(dragDockHeight(300, 500, 400, VH)).toBe(400);
  });
  it("dragging DOWN makes it shorter", () => {
    expect(dragDockHeight(300, 500, 560, VH)).toBe(240);
  });
  it("no pointer movement → unchanged", () => {
    expect(dragDockHeight(300, 500, 500, VH)).toBe(300);
  });
  it("clamps at both ends mid-drag", () => {
    expect(dragDockHeight(300, 500, 5000, VH)).toBe(MIN_DOCK_HEIGHT_PX);
    expect(dragDockHeight(300, 500, -5000, VH)).toBe(maxDockHeight(VH));
  });
});

describe("stepDockHeight", () => {
  it("nudges by the delta and clamps", () => {
    expect(stepDockHeight(300, 24, VH)).toBe(324);
    expect(stepDockHeight(300, -24, VH)).toBe(276);
    expect(stepDockHeight(MIN_DOCK_HEIGHT_PX, -24, VH)).toBe(MIN_DOCK_HEIGHT_PX);
    expect(stepDockHeight(maxDockHeight(VH), 24, VH)).toBe(maxDockHeight(VH));
  });
});

describe("writeDockHeight / readDockHeight", () => {
  it("round-trips a valid height under the owned key", () => {
    const s = new FakeStorage();
    writeDockHeight(432, s);
    expect(s.getItem(DOCK_HEIGHT_KEY)).toBe("432");
    expect(readDockHeight(s)).toBe(432);
  });
  it("rounds fractional heights on write", () => {
    const s = new FakeStorage();
    writeDockHeight(432.7, s);
    expect(readDockHeight(s)).toBe(433);
  });
  it("returns null when nothing was written", () => {
    expect(readDockHeight(new FakeStorage())).toBeNull();
  });
  it("returns the stored value UNCLAMPED (clamping is the caller's job against the live viewport)", () => {
    const s = new FakeStorage();
    writeDockHeight(5000, s);
    expect(readDockHeight(s)).toBe(5000);
  });
  it("treats garbage / sub-minimum stored values as absent", () => {
    const s = new FakeStorage();
    s.setItem(DOCK_HEIGHT_KEY, "banana");
    expect(readDockHeight(s)).toBeNull();
    s.setItem(DOCK_HEIGHT_KEY, "12");
    expect(readDockHeight(s)).toBeNull();
    s.setItem(DOCK_HEIGHT_KEY, "");
    expect(readDockHeight(s)).toBeNull();
  });
  it("refuses to write NaN or sub-minimum values (never replaces a good preference with garbage)", () => {
    const s = new FakeStorage();
    writeDockHeight(400, s);
    writeDockHeight(Number.NaN, s);
    writeDockHeight(5, s);
    expect(readDockHeight(s)).toBe(400);
  });
  it("never throws when storage is unavailable or throws", () => {
    expect(() => writeDockHeight(400, null)).not.toThrow();
    expect(readDockHeight(null)).toBeNull();
    const t = new ThrowingStorage();
    expect(() => writeDockHeight(400, t)).not.toThrow();
    expect(readDockHeight(t)).toBeNull();
    expect(() => clearDockHeight(t)).not.toThrow();
  });
});

describe("clearDockHeight", () => {
  it("forgets the stored preference so the next read falls back to the default", () => {
    const s = new FakeStorage();
    writeDockHeight(400, s);
    clearDockHeight(s);
    expect(readDockHeight(s)).toBeNull();
    expect(resolveDockHeight(readDockHeight(s), VH)).toBe(defaultDockHeight(VH));
  });
});
