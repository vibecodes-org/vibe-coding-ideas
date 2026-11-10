import { describe, it, expect } from "vitest";
import { isLayoutEchoHop, resolveDragOver, type ColumnHop } from "./drag-column-hop";

const hop: ColumnHop = {
  fromColumnId: "todo",
  toColumnId: "backlog",
  pointerX: -240,
  pointerY: -520,
};

describe("isLayoutEchoHop", () => {
  it("allows the first hop of a drag", () => {
    expect(isLayoutEchoHop(null, "backlog", -240, -520)).toBe(false);
  });

  it("ignores a hop straight back when the pointer has not moved (page shrank under it)", () => {
    expect(isLayoutEchoHop(hop, "todo", -240, -520)).toBe(true);
  });

  it("allows a hop back once the pointer has actually moved", () => {
    expect(isLayoutEchoHop(hop, "todo", -200, -520)).toBe(false);
    expect(isLayoutEchoHop(hop, "todo", -240, -500)).toBe(false);
  });

  it("allows a hop onward to a third column even with the pointer still (sideways edge scroll)", () => {
    expect(isLayoutEchoHop(hop, "prog", -240, -520)).toBe(false);
  });
});

describe("resolveDragOver (highlight must match where the card lands)", () => {
  it("highlights the column the card is in when an echo hop is ignored", () => {
    // card hopped todo -> backlog; layout then reports todo under the still pointer
    const r = resolveDragOver(hop, "backlog", "todo", -240, -520);
    expect(r.hop).toBeNull();
    expect(r.landingColumnId).toBe("backlog");
  });

  it("highlights the new column after a real hop and records it", () => {
    const r = resolveDragOver(hop, "backlog", "todo", -200, -520);
    expect(r.landingColumnId).toBe("todo");
    expect(r.hop).toEqual({ fromColumnId: "backlog", toColumnId: "todo", pointerX: -200, pointerY: -520 });
  });

  it("same column hover highlights that column with no hop", () => {
    const r = resolveDragOver(null, "todo", "todo", 0, 0);
    expect(r).toEqual({ landingColumnId: "todo", hop: null });
  });
});
