import { describe, it, expect } from "vitest";
import { resolveSessionName, shortSessionId } from "./resolve-session-name";

describe("resolveSessionName — precedence (Requirements §3)", () => {
  it("uses the user's own name when set, over everything else", () => {
    expect(
      resolveSessionName({
        displayName: "Auth spike — keep alive",
        taskTitle: "Fix login redirect loop",
        ideaTitle: "Vibe Coding Ideas",
        sessionId: "a3f9c2e1",
      }),
    ).toBe("Auth spike — keep alive");
  });

  it("falls back to the task title when there is no user name", () => {
    expect(
      resolveSessionName({
        displayName: null,
        taskTitle: "Fix login redirect loop",
        ideaTitle: "Vibe Coding Ideas",
        sessionId: "a3f9c2e1",
      }),
    ).toBe("Fix login redirect loop");
  });

  it("falls back to '<idea title> · <sid4>' when there is neither a user name nor a task title (toolbar-launched)", () => {
    expect(
      resolveSessionName({
        displayName: null,
        taskTitle: null,
        ideaTitle: "Vibe Coding Ideas",
        sessionId: "a3f9c2e1",
      }),
    ).toBe("Vibe Coding Ideas · a3f9");
  });

  it("falls back to 'Session · <sid4>' when the idea title is also blank — never a bare id, never an empty left half", () => {
    expect(
      resolveSessionName({
        displayName: null,
        taskTitle: null,
        ideaTitle: null,
        sessionId: "9c2e1234",
      }),
    ).toBe("Session · 9c2e");

    expect(
      resolveSessionName({
        displayName: "   ",
        taskTitle: undefined,
        ideaTitle: "   ",
        sessionId: "9c2e1234",
      }),
    ).toBe("Session · 9c2e");
  });
});

describe("resolveSessionName — trimming", () => {
  it("treats a whitespace-only display name as unset and falls through to the task title", () => {
    expect(
      resolveSessionName({
        displayName: "   ",
        taskTitle: "Fix login redirect loop",
        ideaTitle: "Vibe Coding Ideas",
        sessionId: "a3f9c2e1",
      }),
    ).toBe("Fix login redirect loop");
  });

  it("treats a whitespace-only task title as unset and falls through to the fallback", () => {
    expect(
      resolveSessionName({
        displayName: null,
        taskTitle: "  \n ",
        ideaTitle: "Vibe Coding Ideas",
        sessionId: "a3f9c2e1",
      }),
    ).toBe("Vibe Coding Ideas · a3f9");
  });

  it("trims surrounding whitespace off a real user name before returning it", () => {
    expect(resolveSessionName({ displayName: "  Auth spike  ", sessionId: "a3f9c2e1" })).toBe("Auth spike");
  });
});

describe("resolveSessionName — worked-example edge cases (design §1 table)", () => {
  it("keeps emoji verbatim in a user-set name", () => {
    expect(resolveSessionName({ displayName: "🚀 Ship the launch page", sessionId: "a3f9c2e1" })).toBe(
      "🚀 Ship the launch page",
    );
  });

  it("keeps an RTL name verbatim (rendering direction is a UI/dir=auto concern, not this function's)", () => {
    const rtl = "إصلاح تسجيل الدخول";
    expect(resolveSessionName({ displayName: rtl, sessionId: "a3f9c2e1" })).toBe(rtl);
  });

  it("passes a very long task title through unmodified — truncation is a display/CSS concern, not this function's", () => {
    const long = "Terminal sessions need names that stick — so resuming the right one is obvious";
    expect(resolveSessionName({ taskTitle: long, ideaTitle: "Vibe Coding Ideas", sessionId: "a3f9c2e1" })).toBe(long);
  });

  it("no session id yet → the fallback still resolves, using the ellipsis placeholder", () => {
    expect(resolveSessionName({ ideaTitle: "Vibe Coding Ideas", sessionId: null })).toBe("Vibe Coding Ideas · …");
  });
});

describe("shortSessionId", () => {
  it("takes the first 4 characters — unified everywhere (the chooser's old 8-char fallback is retired)", () => {
    expect(shortSessionId("a3f9c2e1-eeee")).toBe("a3f9");
  });

  it("returns an ellipsis placeholder when no sid is known yet", () => {
    expect(shortSessionId(null)).toBe("…");
    expect(shortSessionId(undefined)).toBe("…");
    expect(shortSessionId("")).toBe("…");
  });
});
