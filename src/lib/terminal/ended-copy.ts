// In-app terminal — what the "session ended" panel says, per reason
// (card 6b2cb8ac).
//
// Every string here is copied from the approved mock
// (docs/terminal-fresh-mac-folder-mock.html, sections 2, 3 and 4b; Nick
// approved it on 17 Oct 2026) or, for the reasons that predate it, from the
// panel's existing wording. Pure: terminal-session-view.tsx renders the result
// with the panel's existing anatomy (icon, title, message, one main button,
// small links). ended-copy.test.ts pins every string and keeps error-speak and
// jargon out.

import type { EndedReason } from "./connection";

export type EndedCopyAgent = "claude" | "codex";

/** One run of the message: plain text, or a short `code`-styled value. */
export interface EndedCopyPart {
  text?: string;
  code?: string;
}

export interface EndedCopyInput {
  reason: EndedReason | null;
  /** connection.ts → `endedDetail`: an exit code, or "old-helper". */
  detail: string | null;
  agent: EndedCopyAgent;
  /** The session's project folder for display (`~`-shortened), when known. */
  folder: string | null;
  /** The board's GitHub repo, when it has one. */
  repo: { owner: string; name: string } | null;
  /** Where a download or a new folder would go (`~/projects/<name>`), when known. */
  newFolder: string | null;
}

export interface EndedCopy {
  title: string;
  body: EndedCopyPart[];
  /**
   * "resume" → "Resume this conversation" + "Start fresh" when the panel can
   * resume, else "Start again". "start-again" → only "Start again" (nothing
   * ever started, so there is nothing to resume).
   */
  primary: "start-again" | "resume";
  /** "How to install …" link (agent not installed). */
  installLink?: { agent: EndedCopyAgent; label: string };
  /** The old-helper screen: "Update now" first, Start again as the outline button. */
  showUpdate: boolean;
  /** Offer "Show what happened" (the terminal lines under the message carry the detail). */
  showDetails: boolean;
  /** The one-line bar shown after "Show what happened" (mock 3e). */
  barText: string;
}

const AGENT_NAME: Record<EndedCopyAgent, string> = { claude: "Claude Code", codex: "Codex" };
const AGENT_COMMAND: Record<EndedCopyAgent, string> = { claude: "claude", codex: "codex" };

/** Reasons where the agent never really started — nothing to resume. */
const NEVER_STARTED: ReadonlySet<EndedReason> = new Set<EndedReason>([
  "agent-stopped-early",
  "agent-not-installed",
  "folder-missing",
  "folder-unavailable",
  "folder-not-allowed",
  "folder-lookup-failed",
  "clone-failed",
  "clone-no-access",
  "git-missing",
]);

/**
 * May the ended panel offer "Resume this conversation"? Never after the
 * user's own End, and never for a session that never started (there is no
 * conversation to reopen — today's Resume there just died again).
 */
export function endedReasonAllowsResume(reason: EndedReason | null): boolean {
  if (reason === "user") return false;
  if (reason && NEVER_STARTED.has(reason)) return false;
  return true;
}

const t = (text: string): EndedCopyPart => ({ text });
const c = (code: string): EndedCopyPart => ({ code });

/** The message as plain text (tests, the "Show what happened" bar, logs). */
export function endedCopyText(body: readonly EndedCopyPart[]): string {
  return body.map((p) => p.text ?? p.code ?? "").join("");
}

function stoppedStraightAway(agent: EndedCopyAgent): string {
  return `${AGENT_NAME[agent]} stopped on your Mac straight away`;
}

export function endedCopy(input: EndedCopyInput): EndedCopy {
  const { reason, detail, agent, folder, repo, newFolder } = input;
  const name = AGENT_NAME[agent];
  const plain = (title: string, body: EndedCopyPart[], extra: Partial<EndedCopy> = {}): EndedCopy => ({
    title,
    body,
    primary: "start-again",
    showUpdate: false,
    showDetails: false,
    barText: `${title}.`,
    ...extra,
  });

  switch (reason) {
    case "folder-missing":
      // Mock 2a.
      return plain(stoppedStraightAway(agent), [
        ...(folder
          ? [t("The project folder "), c(folder), t(" isn't on this Mac")]
          : [t("The project folder isn't on this Mac")]),
        t(
          ", so this conversation can't be reopened here. Start again for a new session: VibeCodes will find or download the project on this Mac."
        ),
      ]);

    case "agent-not-installed":
      // Mock 2b / 2c.
      return plain(stoppedStraightAway(agent), [t(`${name} isn't installed on this Mac. Install it, then start again.`)], {
        installLink: { agent, label: `How to install ${name}` },
      });

    case "agent-stopped-early":
      if (detail === "old-helper") {
        // Mock 2e.
        return plain(
          stoppedStraightAway(agent),
          [t("The VibeCodes helper on this Mac is out of date, so it can't tell us why. Update it, then start again.")],
          { showUpdate: true }
        );
      }
      // Mock 2d.
      return plain(
        stoppedStraightAway(agent),
        [
          t(
            detail && /^\d+$/.test(detail)
              ? `It closed before it showed anything (exit code ${detail}). Start again. If it keeps happening, open Terminal on this Mac and type `
              : "It closed before it showed anything. Start again. If it keeps happening, open Terminal on this Mac and type "
          ),
          c(AGENT_COMMAND[agent]),
          t(" to see its own message."),
        ],
        { showDetails: true }
      );

    case "clone-no-access": {
      // Mock 3a.
      const title = repo ? `Couldn't download ${repo.name}` : "Couldn't download the project";
      const body = repo
        ? [
            t("It's a private GitHub project, and this Mac isn't signed in to GitHub with an account that can see "),
            c(`${repo.owner}/${repo.name}`),
            t(". Sign this Mac in to GitHub (in Terminal: "),
            c("gh auth login"),
            t("), or download it once yourself with "),
            c(`git clone https://github.com/${repo.owner}/${repo.name}.git ~/projects/${repo.name}`),
            t(". Then start again."),
          ]
        : [
            t("It's a private GitHub project, and this Mac isn't signed in to GitHub with an account that can see it. Sign this Mac in to GitHub (in Terminal: "),
            c("gh auth login"),
            t("), then start again."),
          ];
      return plain(title, body, { showDetails: true });
    }

    case "clone-failed":
      // Mock 3b.
      return plain(
        repo ? `Couldn't download ${repo.name}` : "Couldn't download the project",
        [
          t(
            "The download from GitHub stopped before it finished. Check this Mac's internet connection, then start again. Nothing half-downloaded was left behind."
          ),
        ],
        { showDetails: true }
      );

    case "git-missing":
      // Mock 3c.
      return plain("This Mac needs Apple's developer tools first", [
        t(
          "Git isn't installed yet, so the project can't be downloaded. Your Mac is showing Apple's installer now: click Install (it takes a few minutes), then start again."
        ),
      ]);

    case "folder-unavailable":
      // Mock 3d (first panel).
      return plain("Couldn't create the project folder", [
        ...(newFolder ? [c(newFolder), t(" couldn't be created on this Mac.")] : [t("The project folder couldn't be created on this Mac.")]),
        t(" Check there's free space, then start again."),
      ]);

    case "folder-lookup-failed":
      // Mock 3d (second panel).
      return plain("Couldn't check where this project lives", [
        t("The helper on this Mac couldn't reach VibeCodes to look it up. Check this Mac's internet connection, then start again."),
      ]);

    case "folder-not-allowed":
      // Not in the mock (the helper's final guard; it should never trigger in
      // practice). Same tone and anatomy as 3d.
      return plain("Couldn't find a safe project folder", [
        t(
          "The helper on this Mac never starts an agent in your home folder or at the top of the disk. Start again, and if it keeps happening, set this board's project folder from the launch menu."
        ),
      ]);

    case "helper-closed":
      // Mock 4b (new message). The conversation did run, so Resume stays.
      return plain(
        "The helper on your Mac was closed",
        [t(`${name} stopped because the VibeCodes helper quit (for example, for an update). Your conversation is saved.`)],
        { primary: "resume" }
      );

    // ── Reasons that predate card 6b2cb8ac: today's wording, unchanged ──
    case "user":
      return plain("You ended the session", [t("Claude Code on your machine stopped. The scrollback above is kept.")]);
    case "idle":
      return plain(
        "Ended after being idle",
        [t("We closed the session to keep things tidy and safe. Nothing went wrong — your work on your machine is untouched.")],
        { primary: "resume" }
      );
    case "max-duration":
      return plain(
        "Reached the session time limit",
        [t("We closed the session to keep things tidy and safe. Nothing went wrong — your work on your machine is untouched.")],
        { primary: "resume" }
      );
    case "reconnect-failed":
      return plain(
        "This session ended",
        [t("We couldn't reattach in time after the connection dropped. Your saved work is safe — start a new session to pick things back up.")],
        { primary: "resume" }
      );
    default:
      return plain("Session ended", [t("Claude Code on your machine stopped. The scrollback above is kept.")], {
        primary: "resume",
      });
  }
}

/** Words the ended copy must never use (same spirit as first-run-copy.ts). */
export const FORBIDDEN_ENDED_COPY = ["Failed", "Error", "port", "token", "relay", "pty", "cwd", "bridge", "exited"] as const;

const ALL_REASONS: ReadonlyArray<EndedReason | null> = [
  null,
  "user",
  "remote",
  "idle",
  "max-duration",
  "reconnect-failed",
  "agent-stopped-early",
  "agent-not-installed",
  "folder-missing",
  "folder-unavailable",
  "folder-not-allowed",
  "folder-lookup-failed",
  "clone-failed",
  "clone-no-access",
  "git-missing",
  "helper-closed",
];

/** Every string the ended panel can show, across reasons, agents and known/unknown inputs (forbidden-words test). */
export function collectEndedCopy(): string[] {
  const out: string[] = [];
  for (const reason of ALL_REASONS) {
    for (const agent of ["claude", "codex"] as const) {
      for (const known of [true, false]) {
        for (const detail of reason === "agent-stopped-early" ? ["1", "old-helper", null] : [null]) {
          const copy = endedCopy({
            reason,
            detail,
            agent,
            folder: known ? "~/projects/example" : null,
            repo: known ? { owner: "you", name: "example" } : null,
            newFolder: known ? "~/projects/example" : null,
          });
          out.push(copy.title, endedCopyText(copy.body), copy.barText);
          if (copy.installLink) out.push(copy.installLink.label);
        }
      }
    }
  }
  return out;
}
