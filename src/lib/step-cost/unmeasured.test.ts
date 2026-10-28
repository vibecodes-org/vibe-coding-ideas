import { describe, it, expect } from "vitest";
import { unmeasuredGroupKey, unmeasuredLabel } from "./unmeasured";

describe("unmeasuredLabel", () => {
  it("says it in plain English for every kind", () => {
    expect(unmeasuredLabel("no_transcript", "no-script")).toEqual({ text: "The measuring tool isn't installed on that machine" });
    expect(unmeasuredLabel("no_transcript", "a1b2c3")).toEqual({ text: "No record of the helper's work was found" });
    expect(unmeasuredLabel("no_transcript", null)).toEqual({ text: "No record of the work was found" });
    expect(unmeasuredLabel("unavailable", "no shell here")).toEqual({ text: "The session couldn't run the measuring command:", quote: "no shell here" });
    expect(unmeasuredLabel("unreadable", "not JSON")).toEqual({ text: "The cost report it sent couldn't be read" });
    expect(unmeasuredLabel("codex", null)).toEqual({ text: "Codex step: Codex doesn't report its cost" });
  });
});

describe("unmeasuredGroupKey", () => {
  it("treats capitals and spacing as the same reason", () => {
    expect(unmeasuredGroupKey("unavailable", "No  Shell")).toBe(unmeasuredGroupKey("unavailable", " no shell "));
    expect(unmeasuredGroupKey("unavailable", "no shell")).not.toBe(unmeasuredGroupKey("unavailable", "no network"));
  });
  it("groups NO_TRANSCRIPT agent ids together but apart from no-script and bare", () => {
    expect(unmeasuredGroupKey("no_transcript", "a1")).toBe(unmeasuredGroupKey("no_transcript", "zz9"));
    expect(unmeasuredGroupKey("no_transcript", "No-Script")).toBe(unmeasuredGroupKey("no_transcript", "no-script"));
    const keys = new Set([unmeasuredGroupKey("no_transcript", "no-script"), unmeasuredGroupKey("no_transcript", "a1"), unmeasuredGroupKey("no_transcript", null)]);
    expect(keys.size).toBe(3);
  });
  it("other kinds group by kind alone", () => {
    expect(unmeasuredGroupKey("unreadable", "not JSON")).toBe(unmeasuredGroupKey("unreadable", "x"));
    expect(unmeasuredGroupKey("codex", null)).toBe("codex");
  });
});
