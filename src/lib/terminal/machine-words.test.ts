import { describe, it, expect } from "vitest";
import { MAC_ONLY_WORDS, forMachine, machineWords } from "./machine-words";
import { reconnectCopy } from "./reconnect-copy";
import { E2EE_COPY, e2eeCopyFor, notEncryptedCopy } from "./e2ee-copy";
import { collectEndedCopy, endedCopy, endedCopyText } from "./ended-copy";
import { ALWAYS_ON_CONSENT_BODY, alwaysOnConsentBody, deriveHelperChip } from "./helper-row";
import { settledNoticeCopy, updateConfirmBody } from "./helper-update-flow";
import { CODEX_SIGNIN_HINT } from "./agent-copy";
import { collectSetupCopy, setupScreenCopy } from "./setup-copy";
import type { TerminalOs } from "./platform";

/** Every terminal sentence that says "Mac" on a Mac, in the given system's words. */
function everyMachineString(os: TerminalOs): string[] {
  const flat = (v: unknown): string[] =>
    typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(flat) : [];
  const status = { connected: true, stoppedUnexpectedly: false } as Parameters<typeof deriveHelperChip>[0];
  return [
    ...[false, true].flatMap((w) => flat(reconnectCopy(w, os))),
    ...flat(e2eeCopyFor(os)),
    ...flat(notEncryptedCopy(null, os)),
    ...flat(notEncryptedCopy("999.0.0", os)),
    ...collectEndedCopy(os),
    ...flat(deriveHelperChip(status, 2, os)),
    alwaysOnConsentBody(os),
    updateConfirmBody(1, os),
    updateConfirmBody(3, os),
    settledNoticeCopy("ready", os),
    settledNoticeCopy("helper-unreachable", os),
    settledNoticeCopy("quiesce-timeout", os),
    forMachine(CODEX_SIGNIN_HINT, os),
    ...collectSetupCopy(os),
  ];
}

describe("machine wording (card 51d424f7)", () => {
  it("the Mac's words are unchanged", () => {
    expect(machineWords("mac")).toEqual({ machine: "Mac", promptAsker: "your Mac", trayPlace: "menu bar" });
    expect(machineWords("windows")).toEqual({
      machine: "PC",
      promptAsker: "your browser",
      trayPlace: "the icon by the clock",
    });
  });

  it("forMachine leaves every Mac (and unknown-system) sentence byte-identical", () => {
    const s = "This Mac needs Apple's developer tools first";
    expect(forMachine(s, "mac")).toBe(s);
    expect(forMachine(s, "other")).toBe(s);
    expect(forMachine(s, undefined)).toBe(s);
    expect(everyMachineString("mac")).toEqual(everyMachineString("other"));
    expect(e2eeCopyFor("mac")).toBe(E2EE_COPY);
    expect(alwaysOnConsentBody()).toBe(ALWAYS_ON_CONSENT_BODY);
  });

  it("the Mac output still says Mac (the sweep really covers the Mac sentences)", () => {
    expect(everyMachineString("mac").filter((s) => s.includes("Mac")).length).toBeGreaterThan(20);
  });

  it.each(MAC_ONLY_WORDS)("no Windows sentence mentions %s", (word) => {
    const offenders = everyMachineString("windows").filter((s) => s.includes(word));
    expect(offenders).toEqual([]);
  });

  it("rewrites the Mac-only instructions to their Windows equivalents", () => {
    const os: TerminalOs = "windows";
    expect(reconnectCopy(true, os).title).toBe("Still waiting for your PC.");
    expect(alwaysOnConsentBody(os)).toBe(
      "The helper starts when you sign in to your PC and stays running so terminals connect faster. It shows an icon by the clock, and you can turn this off or quit it there any time.",
    );
    expect(settledNoticeCopy("ready", os)).toBe(
      "Ready to update — the helper has closed. Open the new installer to finish.",
    );
    expect(settledNoticeCopy("helper-unreachable", os)).toContain("its icon by the clock or Task Manager");
    const git = endedCopy({ reason: "git-missing", detail: null, agent: "claude", folder: null, repo: null, newFolder: null, os });
    expect(git.title).toBe("This PC needs Git first");
    expect(endedCopyText(git.body)).toContain("Git for Windows");
    const early = endedCopy({ reason: "agent-stopped-early", detail: null, agent: "claude", folder: null, repo: null, newFolder: null, os });
    expect(endedCopyText(early.body)).toContain("open PowerShell and type claude");
    const noAccess = endedCopy({ reason: "clone-no-access", detail: null, agent: "codex", folder: null, repo: null, newFolder: null, os });
    expect(endedCopyText(noAccess.body)).toContain("(in PowerShell: gh auth login)");
  });

  // Nick, 24 Nov 2026: one-click install and sign-in wait for release 1c, so a
  // PC sees one "install it yourself, then Start again" screen.
  it.each(["start", "diy", "old-helper"] as const)("Windows %s screen: no install, sign-in or Mac command", (screen) => {
    const c = setupScreenCopy(screen, "claude", "windows");
    expect(c.title).toBe("Set up Claude Code on this PC");
    expect(c.body).toBe(
      "Claude Code isn't on this PC yet. Install it using Anthropic's own instructions, then click Start again. Some features are still coming to Windows."
    );
    expect(c.steps).toEqual([]);
    expect(c.copyBox).toBeNull();
    expect(c.buttons).toEqual([{ id: "start-again", label: "Start again", tone: "primary" }]);
    expect(c.links.map((l) => l.id)).toEqual(["guide", "sessions"]);
    expect(setupScreenCopy(screen, "codex", "windows").body).toContain("OpenAI's own instructions");
  });

  it("the Mac setup screens are unchanged", () => {
    expect(collectSetupCopy("mac")).toEqual(collectSetupCopy());
    expect(setupScreenCopy("start", "claude", "mac").steps).toHaveLength(3);
  });
});
