import { describe, it, expect } from "vitest";
import { isLayoutEchoHop, type ColumnHop } from "./drag-column-hop";

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
