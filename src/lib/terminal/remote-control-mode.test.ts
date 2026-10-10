import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  REMOTE_CONTROL_APPLIES_TO_RESUME,
  REMOTE_CONTROL_EARLY_EXIT_HINT,
  REMOTE_CONTROL_EARLY_EXIT_MS,
  shouldShowRemoteControlEarlyExitHint,
  REMOTE_CONTROL_CHIP,
  REMOTE_CONTROL_CHOOSER_REMINDER_NEW_ONLY,
  REMOTE_CONTROL_DIALOG_REMINDER_NEW_ONLY,
  REMOTE_CONTROL_HELP_OFF,
  REMOTE_CONTROL_HELP_OFF_NEW_ONLY,
  REMOTE_CONTROL_HELP_ON,
  REMOTE_CONTROL_HELP_ON_NEW_ONLY,
  REMOTE_CONTROL_SIGN_IN_NOTE,
  REMOTE_CONTROL_SWITCH_LABEL,
  remoteControlForLaunch,
  terminalLaunchRemoteControlChip,
  terminalLaunchRemoteControlReminder,
  terminalRemoteControlHelp,
} from "./remote-control-mode";

describe("terminalLaunchRemoteControlChip", () => {
  it("is the approved label when on and null when off", () => {
    expect(terminalLaunchRemoteControlChip(true)).toBe("📱 remote control on");
    expect(terminalLaunchRemoteControlChip(false)).toBeNull();
  });
});

describe("terminalRemoteControlHelp", () => {
  it("covers the four on/off x resume variants", () => {
    expect(terminalRemoteControlHelp(false, { appliesToResume: true, needsSignIn: false })).toBe(REMOTE_CONTROL_HELP_OFF);
    expect(terminalRemoteControlHelp(true, { appliesToResume: true, needsSignIn: false })).toBe(REMOTE_CONTROL_HELP_ON);
    expect(terminalRemoteControlHelp(false, { appliesToResume: false, needsSignIn: false })).toBe(
      REMOTE_CONTROL_HELP_OFF_NEW_ONLY,
    );
    expect(terminalRemoteControlHelp(true, { appliesToResume: false, needsSignIn: false })).toBe(
      REMOTE_CONTROL_HELP_ON_NEW_ONLY,
    );
  });

  it("appends the sign-in line when it's needed", () => {
    expect(terminalRemoteControlHelp(true, { appliesToResume: true, needsSignIn: true })).toBe(
      `${REMOTE_CONTROL_HELP_ON} ${REMOTE_CONTROL_SIGN_IN_NOTE}`,
    );
  });

  it("defaults to the two module switches", () => {
    expect(terminalRemoteControlHelp(false)).toBe(
      terminalRemoteControlHelp(false, { appliesToResume: REMOTE_CONTROL_APPLIES_TO_RESUME }),
    );
  });
});

describe("terminalLaunchRemoteControlReminder", () => {
  it("is null while resumes are covered", () => {
    expect(terminalLaunchRemoteControlReminder("chooser", true)).toBeNull();
    expect(terminalLaunchRemoteControlReminder("dialog", true)).toBeNull();
  });

  it("is the surface's 'new sessions only' line when they aren't", () => {
    expect(terminalLaunchRemoteControlReminder("chooser", false)).toBe(REMOTE_CONTROL_CHOOSER_REMINDER_NEW_ONLY);
    expect(terminalLaunchRemoteControlReminder("dialog", false)).toBe(REMOTE_CONTROL_DIALOG_REMINDER_NEW_ONLY);
  });
});

describe("remoteControlForLaunch", () => {
  it("is true for a requested Claude launch, fresh or (while covered) resume", () => {
    expect(remoteControlForLaunch({ requested: true, agent: "claude", isResume: false })).toBe(true);
    expect(remoteControlForLaunch({ requested: true, agent: undefined, isResume: false })).toBe(true);
    expect(remoteControlForLaunch({ requested: true, agent: null, isResume: true, appliesToResume: true })).toBe(true);
  });

  it("is undefined when not requested, for Codex, or for a resume that isn't covered", () => {
    expect(remoteControlForLaunch({ requested: false, agent: "claude", isResume: false })).toBeUndefined();
    expect(remoteControlForLaunch({ requested: true, agent: "codex", isResume: false })).toBeUndefined();
    expect(remoteControlForLaunch({ requested: true, agent: "codex", isResume: true })).toBeUndefined();
    expect(
      remoteControlForLaunch({ requested: true, agent: "claude", isResume: true, appliesToResume: false }),
    ).toBeUndefined();
    expect(
      remoteControlForLaunch({ requested: true, agent: "claude", isResume: false, appliesToResume: false }),
    ).toBe(true);
  });
});

describe("copy matches the approved mock (docs/terminal-remote-control-ux.html) verbatim", () => {
  const mock = fs.readFileSync(path.resolve(__dirname, "../../../docs/terminal-remote-control-ux.html"), "utf8");
  const copy = (key: string): string => {
    const m = mock.match(new RegExp(`\\n\\s*${key}: "((?:[^"\\\\]|\\\\.)*)"`));
    if (!m) throw new Error(`COPY.${key} not found in the mock`);
    return m[1];
  };

  it.each([
    ["label", REMOTE_CONTROL_SWITCH_LABEL],
    ["offHelp", REMOTE_CONTROL_HELP_OFF],
    ["onHelp", REMOTE_CONTROL_HELP_ON],
    ["offHelpNewOnly", REMOTE_CONTROL_HELP_OFF_NEW_ONLY],
    ["onHelpNewOnly", REMOTE_CONTROL_HELP_ON_NEW_ONLY],
    ["signIn", REMOTE_CONTROL_SIGN_IN_NOTE],
    ["chip", REMOTE_CONTROL_CHIP],
    ["chooserReminderNewOnly", REMOTE_CONTROL_CHOOSER_REMINDER_NEW_ONLY],
    ["dialogReminderNewOnly", REMOTE_CONTROL_DIALOG_REMINDER_NEW_ONLY],
  ])("COPY.%s", (key, value) => {
    expect(value).toBe(copy(key));
  });
});

describe("shouldShowRemoteControlEarlyExitHint (task 5c8969cc, live check V3)", () => {
  const T = 1_000_000;
  const base = { launchedWithRemoteControl: true, endedReason: "remote", firstOutputAt: T };

  it("is shown when Claude stops 2s after its first output", () => {
    expect(shouldShowRemoteControlEarlyExitHint({ ...base, endedAt: T + 2_000 })).toBe(true);
  });

  it("is shown at exactly 15000ms and not at 15001ms", () => {
    expect(REMOTE_CONTROL_EARLY_EXIT_MS).toBe(15_000);
    expect(shouldShowRemoteControlEarlyExitHint({ ...base, endedAt: T + 15_000 })).toBe(true);
    expect(shouldShowRemoteControlEarlyExitHint({ ...base, endedAt: T + 15_001 })).toBe(false);
  });

  it("is shown when Claude ended before any output at all", () => {
    expect(shouldShowRemoteControlEarlyExitHint({ ...base, firstOutputAt: null, endedAt: T })).toBe(true);
  });

  it("is not shown when the launch didn't ask for Remote Control", () => {
    expect(
      shouldShowRemoteControlEarlyExitHint({ ...base, launchedWithRemoteControl: false, endedAt: T + 1 }),
    ).toBe(false);
  });

  it.each(["user", "idle", "max-duration", "reconnect-failed", null])("is not shown for ended reason %s", (endedReason) => {
    expect(shouldShowRemoteControlEarlyExitHint({ ...base, endedReason, endedAt: T + 1 })).toBe(false);
  });

  it("copy matches the approved wording exactly", () => {
    expect(REMOTE_CONTROL_EARLY_EXIT_HINT).toBe(
      'Claude Code stopped straight away — if it\'s out of date, run "claude update", or turn off Remote Control in Settings.',
    );
  });
});
