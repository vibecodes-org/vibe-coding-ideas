import { describe, it, expect } from "vitest";
import {
  FIRST_RUN_COPY,
  FIRST_RUN_COPY_WINDOWS,
  FORBIDDEN_FIRST_RUN_COPY,
  collectFirstRunCopy,
  firstRunCopyFor,
} from "./first-run-copy";
import { MAC_ONLY_WORDS } from "./machine-words";

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

  it("the Linux/phone/tablet panel is a calm 'coming soon' naming Mac and Windows (decision 3, 24 Nov)", () => {
    expect(FIRST_RUN_COPY.comingSoon.heading).toBe("The in-browser terminal works on Mac and Windows for now");
    expect(FIRST_RUN_COPY.comingSoon.body).toBe(
      "It isn't available on this device yet, but you can still run Claude Code the usual way in your own terminal.",
    );
    // The greyed "Download for Windows" button and its hint are gone.
    expect(Object.keys(FIRST_RUN_COPY.comingSoon)).toEqual(["heading", "body"]);
  });
});

describe("first-run copy — Windows (approved mock, card 51d424f7)", () => {
  const w = FIRST_RUN_COPY_WINDOWS;

  it("picks the copy by system, with the Mac copy for anything but Windows", () => {
    expect(firstRunCopyFor("windows")).toBe(FIRST_RUN_COPY_WINDOWS);
    expect(firstRunCopyFor("mac")).toBe(FIRST_RUN_COPY);
    expect(firstRunCopyFor("other")).toBe(FIRST_RUN_COPY);
    expect(firstRunCopyFor(undefined)).toBe(FIRST_RUN_COPY);
  });

  it("matches the mock's middle panel word for word", () => {
    expect(w.setup.heading).toBe("Run Claude Code here — one-time setup");
    expect(w.setup.subheading).toBe("Takes about a minute. You only do this once on this PC.");
    expect(w.setup.step1Title).toBe("Download the VibeCodes helper");
    expect(w.setup.step1Desc).toBe(
      "A small app that lets this page mirror Claude Code from your PC. Your code stays on your computer.",
    );
    expect(w.setup.step2Title).toBe("Open the file to install VibeCodes");
    expect(w.setup.step2Desc).toBe(
      "When the download finishes, open it. It installs in a few seconds and doesn’t ask for an administrator password.",
    );
    expect(w.setup.step2Note?.map((r) => r.text).join("")).toBe(
      "Windows may show “Windows protected your PC”. Click More info, then Run anyway. That’s expected while VibeCodes is new to Windows.",
    );
    expect(w.setup.step2Note?.filter((r) => r.bold).map((r) => r.text)).toEqual([
      "“Windows protected your PC”",
      "More info",
      "Run anyway",
    ]);
    expect(w.setup.step3Title).toBe("Connect this board to the helper");
    expect(w.setup.openPrompt).toBe(
      "When you click Connect, your browser may ask “Open VibeCodes?” — click Open. That’s expected, and it only happens the first time.",
    );
    expect(w.setup.connect).toBe("Connect");
    expect(w.setup.alreadyInstalled).toBe("Already installed it? Just click Connect.");
  });

  it("carries the approved 'still coming' line until release 1c", () => {
    expect(w.setup.previewNote).toBe("Some features are still coming to Windows.");
    expect(FIRST_RUN_COPY.setup).not.toHaveProperty("previewNote");
    expect(FIRST_RUN_COPY.setup).not.toHaveProperty("step2Note");
  });

  it("uses the mock table's wording on the connecting and retry screens", () => {
    expect(w.connecting.heading).toBe("Connecting to your PC…");
    expect(w.connecting.openNudge).toBe("If your browser asks, click Open VibeCodes.");
    expect(w.timeoutNew.body).toBe(
      "If you just installed it, make sure you clicked Open when your browser asked — then try again.",
    );
    expect(w.timeoutReturning.heading).toBe("Couldn’t reach the helper on this PC");
    expect(w.timeoutReturning.reassure).toBe("Your work on your PC is safe.");
    expect(w.ready.body).toBe(
      "This PC is already set up. Start a new session, or pick up one of your other sessions.",
    );
  });

  it.each(MAC_ONLY_WORDS)("no Windows string mentions %s", (word) => {
    const offenders = collectFirstRunCopy(FIRST_RUN_COPY_WINDOWS).filter((s) => s.includes(word));
    // The shared coming-soon heading names both systems on purpose; Windows never sees that panel.
    expect(offenders.filter((s) => s !== FIRST_RUN_COPY.comingSoon.heading)).toEqual([]);
  });

  it("the Mac copy is unchanged", () => {
    expect(FIRST_RUN_COPY.setup.subheading).toBe("Takes about a minute. You only do this once on this Mac.");
    expect(FIRST_RUN_COPY.setup.step2Title).toBe("Open the file and drag VibeCodes to Applications");
    expect(FIRST_RUN_COPY.connecting.heading).toBe("Connecting to your Mac…");
    expect(FIRST_RUN_COPY.timeoutReturning.reassure).toBe("Your work on your Mac is safe.");
  });
});
