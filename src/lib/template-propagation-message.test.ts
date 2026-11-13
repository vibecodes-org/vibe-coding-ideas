import { describe, it, expect } from "vitest";
import { describePropagation } from "./template-propagation-message";

describe("describePropagation", () => {
  it("says nothing extra when no cards use the template", () => {
    expect(describePropagation("Template updated", { runsUpdated: 0 })).toEqual({
      level: "success",
      message: "Template updated",
      details: [],
    });
  });

  it("reports the number of cards updated in green", () => {
    const m = describePropagation("Template updated", { runsUpdated: 2, runsReplaced: 1 });
    expect(m.level).toBe("success");
    expect(m.message).toBe("Template updated. Updated 3 cards that use it.");
  });

  it("uses the singular for one card", () => {
    expect(describePropagation("Step updated", { runsUpdated: 1 }).message).toBe("Step updated. Updated 1 card that uses it.");
  });

  it("goes amber and lists at most 3 cards for kept steps", () => {
    const kept = ["A", "B", "C", "D", "E"].map((t) => ({ taskId: t, title: t, stepTitle: "s" }));
    const m = describePropagation("Template updated", { runsUpdated: 5, keptRemoved: kept });
    expect(m.level).toBe("warning");
    expect(m.details[0]).toContain('"A", "B", "C" and 2 more');
  });

  it("goes amber and says save again for cards that changed while saving", () => {
    const m = describePropagation("Template updated", { runsUpdated: 0, changedWhileSaving: [{ taskId: "1", title: "Fix login" }] });
    expect(m.level).toBe("warning");
    expect(m.details[0]).toContain("Save again to retry");
    expect(m.details[0]).toContain('"Fix login"');
  });
});
