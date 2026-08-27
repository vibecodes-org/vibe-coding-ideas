import { describe, it, expect } from "vitest";
import { isFallbackSessionName, resolveSessionName, shortSessionId } from "./resolve-session-name";

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

describe("resolveSessionName — boardKnown fallback (task b70bcbeb, board-switch UX fix)", () => {
  it("falls back to 'Board not recorded · <sid4>' when boardKnown is false, ignoring any ideaTitle passed alongside it", () => {
    expect(
      resolveSessionName({
        displayName: null,
        taskTitle: null,
        ideaTitle: "Vibe Coding Ideas",
        sessionId: "9c2e1234",
        boardKnown: false,
      }),
    ).toBe("Board not recorded · 9c2e");
  });

  it("still prefers the user's own name and the task title over the boardKnown-false fallback", () => {
    expect(
      resolveSessionName({
        displayName: "Auth spike",
        ideaTitle: null,
        sessionId: "9c2e1234",
        boardKnown: false,
      }),
    ).toBe("Auth spike");
    expect(
      resolveSessionName({
        taskTitle: "Fix login redirect loop",
        ideaTitle: null,
        sessionId: "9c2e1234",
        boardKnown: false,
      }),
    ).toBe("Fix login redirect loop");
  });

  it("omitting boardKnown (undefined) keeps the ordinary ideaTitle-driven fallback — back-compat default", () => {
    expect(resolveSessionName({ ideaTitle: "Vibe Coding Ideas", sessionId: "9c2e1234" })).toBe(
      "Vibe Coding Ideas · 9c2e",
    );
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

describe("isFallbackSessionName — row chip suppression (design §1, de-duplication rule)", () => {
  it("is true for a toolbar-launched, never-renamed session (no user name, no task title)", () => {
    expect(isFallbackSessionName({ displayName: null, taskTitle: null })).toBe(true);
  });

  it("is true when both fields are whitespace-only — trimming matches resolveSessionName", () => {
    expect(isFallbackSessionName({ displayName: "   ", taskTitle: "  \n " })).toBe(true);
  });

  it("is false once a user name is set, even with no task title", () => {
    expect(isFallbackSessionName({ displayName: "Auth spike", taskTitle: null })).toBe(false);
  });

  it("is false for a task-launched session with no rename", () => {
    expect(isFallbackSessionName({ displayName: null, taskTitle: "Fix login redirect loop" })).toBe(false);
  });

  it("is false once a user name is set, even if it happens to look like the fallback shape", () => {
    // Coincidental match is still "not the fallback" by this function's rule
    // (it checks precedence inputs, not the resolved string) — see the
    // exported doc comment for why that's still the right call.
    expect(isFallbackSessionName({ displayName: "Vibe Coding Ideas · a3f9", taskTitle: null })).toBe(false);
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
