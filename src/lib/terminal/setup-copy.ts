// In-app terminal — every word on the setup screens (card 63a60792, stage 1).
//
// Each string is copied from the approved mock
// (docs/terminal-agent-setup-mock.html, sections 1 to 8). Pure: the panel
// (terminal-agent-setup-panel.tsx) lays these out with the ended panel's own
// anatomy; setup-copy.test.ts pins every string and keeps error-speak and
// jargon out of the titles and messages.

import { AGENT_DISPLAY_NAMES, AGENT_INSTALL_COMMANDS, type SetupAgent } from "./agent-install";
import type { SetupAction, SetupScreen } from "./agent-setup";

export type SetupStepState = "done" | "now" | "later";

/** What a button or link on a setup screen does; the panel maps each to a handler. */
export type SetupButtonId =
  | "install"
  | "signin"
  | "signin-code"
  | "start"
  | "start-again"
  | "update"
  | "copy-command"
  | "back"
  | "diy"
  | "show"
  | "guide"
  | "sessions";

export interface SetupStep {
  n: 1 | 2 | 3;
  state: SetupStepState;
  title: string;
  detail: string;
  /** The one button inside this step (when it is the current step). */
  action?: { id: SetupButtonId; label: string };
  /** "Runs on your Mac:" + the command, shown under the install button. */
  command?: string;
}

export interface SetupScreenCopy {
  screen: SetupScreen;
  icon: "download" | "ok" | "alert";
  title: string;
  /** One line under the title; a screen with only a copy box has none. */
  body: string | null;
  steps: SetupStep[];
  /** The "paste this into Terminal" box (screens 7a and 7b). */
  copyBox: { lead: string; command: string; after: string } | null;
  /** Buttons in the row under the content, in order. */
  buttons: { id: SetupButtonId; label: string; tone: "primary" | "outline" | "update" }[];
  /** Small grey links, in order ("guide" and "sessions" are rendered by the panel). */
  links: { id: SetupButtonId; label: string }[];
  /** The one-line bar shown after "Show what happened". */
  barText: string;
}

const MAKER: Record<SetupAgent, string> = { claude: "Anthropic's", codex: "OpenAI's" };
const ACCOUNT: Record<SetupAgent, string> = { claude: "Claude account", codex: "ChatGPT account" };

export const TERMINAL_STEPS_LEAD =
  "Open Terminal on your Mac (Applications, then Utilities, then Terminal), paste this and press Enter:";

/** The bottom-strip words while a setup session is running. */
export function setupLiveStrip(agent: SetupAgent, action: SetupAction): string {
  return action === "install"
    ? `Installing ${AGENT_DISPLAY_NAMES[agent]} on this Mac…`
    : "Waiting for you to finish signing in…";
}

/** The tab label a setup session carries. */
export function setupTabLabel(agent: SetupAgent): string {
  return `Set up ${AGENT_DISPLAY_NAMES[agent]}`;
}

const linkGuide = (agent: SetupAgent) => ({ id: "guide" as const, label: `How to install ${AGENT_DISPLAY_NAMES[agent]}` });
const linkSessions = { id: "sessions" as const, label: "View my other sessions" };
const linkShow = { id: "show" as const, label: "Show what happened" };

export function setupScreenCopy(screen: SetupScreen, agent: SetupAgent): SetupScreenCopy {
  const name = AGENT_DISPLAY_NAMES[agent];
  const command = AGENT_INSTALL_COMMANDS[agent];
  const make = (c: Omit<SetupScreenCopy, "screen" | "barText" | "steps" | "copyBox" | "buttons" | "links"> & Partial<SetupScreenCopy>): SetupScreenCopy => ({
    screen,
    steps: [],
    copyBox: null,
    buttons: [],
    links: [],
    barText: `${c.title}.`,
    ...c,
  });
  const startStep: SetupStep = {
    n: 3,
    state: "later",
    title: `Start ${name}`,
    detail: "It connects to this board the first time.",
  };
  const doneInstall: SetupStep = { n: 1, state: "done", title: `Install ${name}`, detail: "Done." };

  switch (screen) {
    case "start":
      // Mock 1 / 8.
      return make({
        icon: "download",
        title: `Set up ${name} on this Mac`,
        body: `${name} isn't on this Mac yet. VibeCodes can set it up for you here, in three steps. Nothing runs until you click.`,
        steps: [
          {
            n: 1,
            state: "now",
            title: `Install ${name}`,
            detail: `Runs ${MAKER[agent]} own installer. You'll see it working in this tab. It takes about a minute.`,
            action: { id: "install", label: `Install ${name}` },
            command,
          },
          { n: 2, state: "later", title: "Sign in", detail: `With your ${ACCOUNT[agent]}.` },
          startStep,
        ],
        links: [{ id: "diy", label: "Rather do it yourself? Copy the command" }, linkGuide(agent), linkSessions],
      });

    case "signin":
      // Mock 3 / 8.
      return make({
        icon: "ok",
        title: `${name} is installed`,
        body: "One more step before it can start: sign in.",
        steps: [
          doneInstall,
          {
            n: 2,
            state: "now",
            title: `Sign in to ${name}`,
            detail:
              agent === "codex"
                ? "Opens OpenAI's sign-in page in your browser. Sign in with your ChatGPT account, then come back here."
                : "Opens Claude's sign-in page in your browser. If it shows you a code, paste it into this tab.",
            action: { id: "signin", label: `Sign in to ${name}` },
          },
          startStep,
        ],
        links: [
          ...(agent === "codex"
            ? [{ id: "signin-code" as const, label: "Using VibeCodes on a different computer? Sign in with a code instead" }]
            : []),
          linkSessions,
        ],
      });

    case "ready":
      // Mock 5.
      return make({
        icon: "ok",
        title: `${name} is ready`,
        body: `${name} is installed and signed in on this Mac.`,
        steps: [
          doneInstall,
          { n: 2, state: "done", title: "Sign in", detail: "Done." },
          {
            n: 3,
            state: "now",
            title: `Start ${name}`,
            detail: `Starts ${name} in this board's project folder. The first time, it connects to your board and asks you to approve once.`,
            action: { id: "start", label: `Start ${name}` },
          },
        ],
        links: [linkSessions],
      });

    case "install-failed":
      // Mock 6a.
      return make({
        icon: "alert",
        title: `${name} didn't install`,
        body: `${MAKER[agent]} installer stopped before it finished, so ${name} still isn't on this Mac. Check your internet connection and try again, or run the command yourself.`,
        buttons: [
          { id: "install", label: "Try again", tone: "primary" },
          { id: "copy-command", label: "Copy the command", tone: "outline" },
        ],
        links: [linkShow, linkGuide(agent), linkSessions],
      });

    case "signin-failed":
      // Mock 6b.
      return make({
        icon: "alert",
        title: `You're not signed in to ${name} yet`,
        body: "The sign-in closed before it finished. Try again: it only takes a minute.",
        buttons: [{ id: "signin", label: `Sign in to ${name}`, tone: "primary" }],
        links: [
          ...(agent === "codex" ? [{ id: "signin-code" as const, label: "Sign in with a code instead" }] : []),
          linkShow,
          linkSessions,
        ],
      });

    case "diy":
      // Mock 7a.
      return make({
        icon: "download",
        title: `Install ${name} yourself`,
        body: null,
        copyBox: {
          lead: TERMINAL_STEPS_LEAD,
          command,
          after: `When it finishes, come back here and click Start again. ${name} asks you to sign in the first time it starts.`,
        },
        buttons: [
          { id: "start-again", label: "Start again", tone: "primary" },
          { id: "back", label: "Back", tone: "outline" },
        ],
        links: [linkGuide(agent)],
      });

    case "old-helper":
      // Mock 7b.
      return make({
        icon: "download",
        title: `Set up ${name} on this Mac`,
        body: `${name} isn't on this Mac yet. To install it from here, update the VibeCodes helper first. Or install it yourself:`,
        copyBox: {
          lead: TERMINAL_STEPS_LEAD,
          command,
          after: `When it finishes, come back here and click Start again. ${name} asks you to sign in the first time it starts.`,
        },
        buttons: [
          { id: "update", label: "Update now", tone: "update" },
          { id: "start-again", label: "Start again", tone: "outline" },
        ],
        links: [linkGuide(agent), linkSessions],
      });
  }
}

const ALL_SCREENS: readonly SetupScreen[] = ["start", "diy", "old-helper", "signin", "ready", "install-failed", "signin-failed"];

/** Words the titles and messages must never use (same spirit as ended-copy.ts). */
export const FORBIDDEN_SETUP_COPY = ["Failed", "Error", "token", "relay", "pty", "cwd", "bridge", "exited", "stderr", "exit code"] as const;

/** Every string the setup screens can show, for the forbidden-words test. */
export function collectSetupCopy(): string[] {
  const out: string[] = [];
  for (const agent of ["claude", "codex"] as const) {
    for (const screen of ALL_SCREENS) {
      const c = setupScreenCopy(screen, agent);
      out.push(c.title, c.barText);
      if (c.body) out.push(c.body);
      for (const s of c.steps) out.push(s.title, s.detail, ...(s.action ? [s.action.label] : []));
      if (c.copyBox) out.push(c.copyBox.lead, c.copyBox.after);
      out.push(...c.buttons.map((b) => b.label), ...c.links.map((l) => l.label));
    }
    out.push(setupLiveStrip(agent, "install"), setupLiveStrip(agent, "signin"), setupTabLabel(agent));
  }
  return out;
}
