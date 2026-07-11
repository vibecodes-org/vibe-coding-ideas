import { describe, it, expect } from "vitest";
import { canModifyComment, isCommentEdited } from "./comment-utils";

describe("canModifyComment", () => {
  it("allows the author to modify their own comment", () => {
    expect(canModifyComment("user-1", "user-1", [])).toBe(true);
  });

  it("allows a user who owns the authoring bot to modify it", () => {
    expect(canModifyComment("bot-1", "user-1", ["bot-1", "bot-2"])).toBe(true);
  });

  it("denies a user who is neither the author nor a bot owner", () => {
    expect(canModifyComment("user-2", "user-1", [])).toBe(false);
  });

  it("denies when the author is a bot not owned by the current user", () => {
    expect(canModifyComment("bot-3", "user-1", ["bot-1", "bot-2"])).toBe(false);
  });
});

describe("isCommentEdited", () => {
  it("returns false when updated_at is undefined", () => {
    expect(isCommentEdited("2026-01-01T00:00:00Z", undefined)).toBe(false);
  });

  it("returns false when updated_at is null", () => {
    expect(isCommentEdited("2026-01-01T00:00:00Z", null)).toBe(false);
  });

  it("returns false when updated_at equals created_at", () => {
    expect(isCommentEdited("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")).toBe(false);
  });

  it("returns true when updated_at differs from created_at", () => {
    expect(isCommentEdited("2026-01-01T00:00:00Z", "2026-01-01T00:05:00Z")).toBe(true);
  });
});
