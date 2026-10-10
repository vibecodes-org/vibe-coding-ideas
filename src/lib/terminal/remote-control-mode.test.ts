import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  REMOTE_CONTROL_APPLIES_TO_RESUME,
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
