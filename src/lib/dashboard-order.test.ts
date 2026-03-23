import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  type PanelPlacement,
  DEFAULT_PANEL_ORDER,
  SECTION_LABELS,
  readPanelOrder,
  writePanelOrder,
  resetPanelOrder,
  reconcileOrder,
  moveSectionUp,
  moveSectionDown,
  moveSectionToColumn,
  getColumnItems,
  isFirstInColumn,
  isLastInColumn,
} from "./dashboard-order";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, "localStorage", { value: localStorageMock });

describe("dashboard-order", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe("DEFAULT_PANEL_ORDER", () => {
    it("has 7 sections", () => {
      expect(DEFAULT_PANEL_ORDER).toHaveLength(7);
    });

    it("has 3 sections in column 0 and 4 in column 1", () => {
      const col0 = DEFAULT_PANEL_ORDER.filter((p) => p.column === 0);
      const col1 = DEFAULT_PANEL_ORDER.filter((p) => p.column === 1);
      expect(col0).toHaveLength(3);
      expect(col1).toHaveLength(4);
    });

    it("has unique IDs", () => {
      const ids = DEFAULT_PANEL_ORDER.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("every ID has a label", () => {
      for (const p of DEFAULT_PANEL_ORDER) {
        expect(SECTION_LABELS[p.id]).toBeDefined();
      }
    });
  });

  describe("readPanelOrder", () => {
    it("returns null when nothing stored", () => {
      expect(readPanelOrder()).toBeNull();
    });

    it("returns parsed order from localStorage", () => {
      const order: PanelPlacement[] = [
        { id: "my-tasks", column: 1 },
        { id: "my-ideas", column: 0 },
      ];
      localStorageMock.setItem(
        "dashboard-panel-order",
        JSON.stringify(order)
      );
      expect(readPanelOrder()).toEqual(order);
    });

    it("returns null for invalid JSON", () => {
      localStorageMock.setItem("dashboard-panel-order", "not json");
      expect(readPanelOrder()).toBeNull();
    });

    it("returns null for non-array", () => {
      localStorageMock.setItem(
        "dashboard-panel-order",
        JSON.stringify({ id: "x", column: 0 })
      );
      expect(readPanelOrder()).toBeNull();
    });

    it("returns null for invalid item shape", () => {
      localStorageMock.setItem(
        "dashboard-panel-order",
        JSON.stringify([{ id: "x", column: 2 }])
      );
      expect(readPanelOrder()).toBeNull();
    });

    it("returns null for item missing id", () => {
      localStorageMock.setItem(
        "dashboard-panel-order",
        JSON.stringify([{ column: 0 }])
      );
      expect(readPanelOrder()).toBeNull();
    });
  });

  describe("writePanelOrder", () => {
    it("writes to localStorage", () => {
      const order: PanelPlacement[] = [{ id: "my-tasks", column: 0 }];
      writePanelOrder(order);
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "dashboard-panel-order",
        JSON.stringify(order)
      );
    });
  });

  describe("resetPanelOrder", () => {
    it("removes from localStorage", () => {
      resetPanelOrder();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(
        "dashboard-panel-order"
      );
    });
  });

  describe("reconcileOrder", () => {
    it("filters out invisible sections", () => {
      const stored: PanelPlacement[] = [
        { id: "my-bots", column: 0 },
        { id: "my-tasks", column: 0 },
        { id: "my-ideas", column: 1 },
      ];
      const result = reconcileOrder(stored, ["my-tasks", "my-ideas"]);
      expect(result).toEqual([
        { id: "my-tasks", column: 0 },
        { id: "my-ideas", column: 1 },
      ]);
    });

    it("appends new sections at default positions", () => {
      const stored: PanelPlacement[] = [
        { id: "my-tasks", column: 0 },
      ];
      const result = reconcileOrder(stored, [
        "my-tasks",
        "recent-activity",
      ]);
      expect(result).toEqual([
        { id: "my-tasks", column: 0 },
        { id: "recent-activity", column: 1 }, // default column
      ]);
    });

    it("preserves custom column assignments", () => {
      const stored: PanelPlacement[] = [
        { id: "my-ideas", column: 0 }, // moved from default column 1
        { id: "my-tasks", column: 1 },
      ];
      const result = reconcileOrder(stored, ["my-ideas", "my-tasks"]);
      expect(result).toEqual([
        { id: "my-ideas", column: 0 },
        { id: "my-tasks", column: 1 },
      ]);
    });

    it("handles unknown sections defaulting to column 0", () => {
      const stored: PanelPlacement[] = [];
      const result = reconcileOrder(stored, ["unknown-section"]);
      expect(result).toEqual([{ id: "unknown-section", column: 0 }]);
    });

    it("handles empty visible IDs", () => {
      const stored: PanelPlacement[] = [
        { id: "my-tasks", column: 0 },
      ];
      const result = reconcileOrder(stored, []);
      expect(result).toEqual([]);
    });
  });

  describe("moveSectionUp", () => {
    const order: PanelPlacement[] = [
      { id: "a", column: 0 },
      { id: "b", column: 1 },
      { id: "c", column: 0 },
      { id: "d", column: 1 },
    ];

    it("swaps with previous item in same column", () => {
      const result = moveSectionUp(order, "c");
      expect(result[0]).toEqual({ id: "c", column: 0 });
      expect(result[2]).toEqual({ id: "a", column: 0 });
      // Other items unchanged
      expect(result[1]).toEqual({ id: "b", column: 1 });
      expect(result[3]).toEqual({ id: "d", column: 1 });
    });

    it("returns same array if already at top of column", () => {
      const result = moveSectionUp(order, "a");
      expect(result).toBe(order);
    });

    it("returns same array for non-existent id", () => {
      const result = moveSectionUp(order, "z");
      expect(result).toBe(order);
    });

    it("only swaps within the same column", () => {
      const result = moveSectionUp(order, "d");
      // d is second in column 1, b is first in column 1
      expect(result[1]).toEqual({ id: "d", column: 1 });
      expect(result[3]).toEqual({ id: "b", column: 1 });
    });
  });

  describe("moveSectionDown", () => {
    const order: PanelPlacement[] = [
      { id: "a", column: 0 },
      { id: "b", column: 1 },
      { id: "c", column: 0 },
      { id: "d", column: 1 },
    ];

    it("swaps with next item in same column", () => {
      const result = moveSectionDown(order, "a");
      expect(result[0]).toEqual({ id: "c", column: 0 });
      expect(result[2]).toEqual({ id: "a", column: 0 });
    });

    it("returns same array if already at bottom of column", () => {
      const result = moveSectionDown(order, "c");
      expect(result).toBe(order);
    });

    it("returns same array for non-existent id", () => {
      const result = moveSectionDown(order, "z");
      expect(result).toBe(order);
    });
  });

  describe("moveSectionToColumn", () => {
    const order: PanelPlacement[] = [
      { id: "a", column: 0 },
      { id: "b", column: 0 },
      { id: "c", column: 1 },
      { id: "d", column: 1 },
    ];

    it("moves to end of target column", () => {
      const result = moveSectionToColumn(order, "a", 1);
      // a removed from col 0, appended after d in col 1
      expect(result).toEqual([
        { id: "b", column: 0 },
        { id: "c", column: 1 },
        { id: "d", column: 1 },
        { id: "a", column: 1 },
      ]);
    });

    it("returns same array if already in target column", () => {
      const result = moveSectionToColumn(order, "a", 0);
      expect(result).toBe(order);
    });

    it("returns same array for non-existent id", () => {
      const result = moveSectionToColumn(order, "z", 1);
      expect(result).toBe(order);
    });

    it("handles moving to empty column", () => {
      const singleCol: PanelPlacement[] = [
        { id: "a", column: 0 },
        { id: "b", column: 0 },
      ];
      const result = moveSectionToColumn(singleCol, "a", 1);
      expect(result).toEqual([
        { id: "b", column: 0 },
        { id: "a", column: 1 },
      ]);
    });

    it("handles moving to column 0 when it is empty", () => {
      const singleCol: PanelPlacement[] = [
        { id: "a", column: 1 },
        { id: "b", column: 1 },
      ];
      const result = moveSectionToColumn(singleCol, "b", 0);
      expect(result).toEqual([
        { id: "b", column: 0 },
        { id: "a", column: 1 },
      ]);
    });
  });

  describe("getColumnItems", () => {
    it("returns items for column 0", () => {
      const items = getColumnItems(DEFAULT_PANEL_ORDER, 0);
      expect(items.every((p) => p.column === 0)).toBe(true);
      expect(items).toHaveLength(3);
    });

    it("returns items for column 1", () => {
      const items = getColumnItems(DEFAULT_PANEL_ORDER, 1);
      expect(items.every((p) => p.column === 1)).toBe(true);
      expect(items).toHaveLength(4);
    });

    it("preserves order", () => {
      const order: PanelPlacement[] = [
        { id: "a", column: 0 },
        { id: "b", column: 1 },
        { id: "c", column: 0 },
      ];
      const items = getColumnItems(order, 0);
      expect(items.map((p) => p.id)).toEqual(["a", "c"]);
    });
  });

  describe("isFirstInColumn", () => {
    const order: PanelPlacement[] = [
      { id: "a", column: 0 },
      { id: "b", column: 1 },
      { id: "c", column: 0 },
    ];

    it("returns true for first item in column", () => {
      expect(isFirstInColumn(order, "a")).toBe(true);
      expect(isFirstInColumn(order, "b")).toBe(true);
    });

    it("returns false for non-first item", () => {
      expect(isFirstInColumn(order, "c")).toBe(false);
    });

    it("returns false for non-existent id", () => {
      expect(isFirstInColumn(order, "z")).toBe(false);
    });
  });

  describe("isLastInColumn", () => {
    const order: PanelPlacement[] = [
      { id: "a", column: 0 },
      { id: "b", column: 1 },
      { id: "c", column: 0 },
    ];

    it("returns true for last item in column", () => {
      expect(isLastInColumn(order, "c")).toBe(true);
      expect(isLastInColumn(order, "b")).toBe(true);
    });

    it("returns false for non-last item", () => {
      expect(isLastInColumn(order, "a")).toBe(false);
    });

    it("returns false for non-existent id", () => {
      expect(isLastInColumn(order, "z")).toBe(false);
    });
  });
});
