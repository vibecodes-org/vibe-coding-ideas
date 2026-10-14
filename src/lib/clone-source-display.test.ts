import { describe, it, expect } from "vitest";
import { cloneSourceDisplay } from "./clone-source-display";
import { VIBECODES_USER_ID } from "./constants";

const base = { id: "b1", name: "Compass", is_published: false, owner_id: VIBECODES_USER_ID };

describe("cloneSourceDisplay", () => {
  it("links a published source", () => {
    expect(cloneSourceDisplay({ ...base, is_published: true }, "u1")).toEqual({ kind: "link", id: "b1", name: "Compass" });
  });
  it("links an unpublished source the viewer owns", () => {
    expect(cloneSourceDisplay({ ...base, owner_id: "u1" }, "u1")).toEqual({ kind: "link", id: "b1", name: "Compass" });
  });
  it("does not link a hidden built-in agent", () => {
    expect(cloneSourceDisplay(base, "u1")).toEqual({
      kind: "text",
      text: "Cloned from Compass, a retired built-in agent",
    });
  });
  it("does not link someone else's unshared agent", () => {
    expect(cloneSourceDisplay({ ...base, owner_id: "u2" }, "u1")).toEqual({
      kind: "text",
      text: "Cloned from Compass (no longer shared)",
    });
  });
  it("signed-out viewers never count as owners", () => {
    expect(cloneSourceDisplay({ ...base, owner_id: "u2" }, null).kind).toBe("text");
  });
});
