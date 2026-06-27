import { describe, it, expect } from "vitest";
import { markLocalBoardMutation, msSinceLocalBoardMutation } from "./local-mutation-signal";

describe("local-mutation-signal", () => {
  it("returns Infinity for a board that has never been mutated", () => {
    expect(msSinceLocalBoardMutation("never-touched")).toBe(Infinity);
  });

  it("reports elapsed time since the last mutation", () => {
    markLocalBoardMutation("idea-a", 1_000);
    expect(msSinceLocalBoardMutation("idea-a", 1_250)).toBe(250);
  });

  it("uses the latest mark when called repeatedly", () => {
    markLocalBoardMutation("idea-b", 1_000);
    markLocalBoardMutation("idea-b", 5_000);
    expect(msSinceLocalBoardMutation("idea-b", 5_400)).toBe(400);
  });

  it("keeps boards independent", () => {
    markLocalBoardMutation("idea-c", 2_000);
    expect(msSinceLocalBoardMutation("idea-c", 2_100)).toBe(100);
    expect(msSinceLocalBoardMutation("idea-d", 2_100)).toBe(Infinity);
  });
});
