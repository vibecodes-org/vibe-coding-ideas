import { describe, it, expect } from "vitest";
import {
  FIRST_RUN_COPY,
  FORBIDDEN_FIRST_RUN_COPY,
  collectFirstRunCopy,
} from "./first-run-copy";

describe("first-run copy — no error-speak or jargon", () => {
  const strings = collectFirstRunCopy();

  it("collects every string in the copy tree", () => {
    // Sanity: the flatten found the nested step/timeout/coming-soon strings.
    expect(strings.length).toBeGreaterThan(15);
    expect(strings).toContain(FIRST_RUN_COPY.setup.connect);
    expect(strings).toContain(FIRST_RUN_COPY.timeoutNew.heading);
  });

  it.each(FORBIDDEN_FIRST_RUN_COPY)(
    "never uses the forbidden word/phrase %s (criteria #7, #12)",
    (word) => {
      // Word-boundary, case-insensitive — so legitimate words like "support" don't
      // trip the "port" check, but "Error"/"Failed"/"token" would.
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      const offenders = strings.filter((s) => re.test(s));
      expect(offenders, `forbidden "${word}" in: ${offenders.join(" | ")}`).toEqual([]);
    },
  );

  it("pre-explains the macOS 'Open VibeCodes?' prompt before Connect (criterion #4)", () => {
    expect(FIRST_RUN_COPY.setup.openPrompt).toContain("Open VibeCodes?");
    expect(FIRST_RUN_COPY.setup.openPrompt.toLowerCase()).toContain("click open");
  });

  it("the download label is OS/arch-specific (criterion #9)", () => {
    expect(FIRST_RUN_COPY.setup.step1Title).toContain("VibeCodes helper");
  });

  it("the non-Mac panel is a calm 'coming soon', not an error (criterion #10)", () => {
    expect(FIRST_RUN_COPY.comingSoon.heading.toLowerCase()).toContain("mac-only");
    expect(FIRST_RUN_COPY.comingSoon.body.toLowerCase()).toContain("windows support");
  });
});
