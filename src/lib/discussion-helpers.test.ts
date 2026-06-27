import { describe, it, expect } from "vitest";
import { buildDiscussionFromTask } from "./discussion-helpers";

describe("buildDiscussionFromTask", () => {
  it("maps a described task into an open discussion with a provenance line above the preserved body", () => {
    const result = buildDiscussionFromTask(
      {
        idea_id: "idea-1",
        title: "Add OAuth refresh-token rotation",
        description: "Tokens currently never rotate; add rotation + revoke.",
      },
      "user-1"
    );

    expect(result).toEqual({
      idea_id: "idea-1",
      author_id: "user-1",
      title: "Add OAuth refresh-token rotation",
      body:
        "From board task: Add OAuth refresh-token rotation\n\n" +
        "Tokens currently never rotate; add rotation + revoke.",
      status: "open",
    });
    // Provenance line present (mirrors the inverse "From discussion: …") and the
    // user's description is preserved verbatim, not clobbered.
    expect(result.body.startsWith("From board task: Add OAuth refresh-token rotation")).toBe(true);
    expect(result.body).toContain("Tokens currently never rotate; add rotation + revoke.");
  });

  it("uses the provenance line alone as the body when the task has no description", () => {
    const result = buildDiscussionFromTask(
      { idea_id: "idea-1", title: "Investigate flaky test", description: null },
      "user-1"
    );

    expect(result.body).toBe("From board task: Investigate flaky test");
    expect(result.status).toBe("open");
  });

  it("falls back to the provenance line when the description is blank/whitespace only", () => {
    const result = buildDiscussionFromTask(
      { idea_id: "idea-1", title: "Empty desc task", description: "   \n  " },
      "user-1"
    );

    expect(result.body).toBe("From board task: Empty desc task");
  });

  it("trims a whitespace-padded description while keeping the provenance line", () => {
    const result = buildDiscussionFromTask(
      { idea_id: "idea-1", title: "Padded", description: "  real body  " },
      "user-1"
    );

    expect(result.body).toBe("From board task: Padded\n\nreal body");
  });

  it("throws when the task title is blank (cannot seed a titled discussion)", () => {
    expect(() =>
      buildDiscussionFromTask(
        { idea_id: "idea-1", title: "   ", description: "has a body" },
        "user-1"
      )
    ).toThrow(/title is required/i);
  });
});
