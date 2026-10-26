// The lines the bridge writes into the terminal while it gets the project
// folder ready on this Mac, and when it can't (card 6b2cb8ac). Strings come
// from the approved mock, docs/terminal-fresh-mac-folder-mock.html (sections 1
// and 3). Pure, so every line is unit-tested without a PTY or relay.
//
// Progress lines carry a teal "VibeCodes" tag (information); failure lines are
// yellow like the bridge's existing notes (agent-copy.js, worktree-eligibility.js).
// Paths are shown with `~` for the home folder. The screens the page shows on
// top (titles, Start again) live in the app: src/lib/terminal/ended-copy.ts.

const TAG = "\x1b[1;36mVibeCodes\x1b[0m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const NL = "\r\n";

/** @type {Record<string, string>} */
const AGENT_NAMES = { claude: "Claude Code", codex: "Codex" };

/** @param {string} agent */
function agentName(agent) {
  return AGENT_NAMES[agent] || "Claude Code";
}

/**
 * `/Users/you/code/x` → `~/code/x` when it's under `home`.
 * @param {string} p @param {string} home
 */
export function displayPath(p, home) {
  if (!home || home === "/") return p;
  const h = home.replace(/\/+$/, "");
  if (p === h) return "~";
  if (p.startsWith(`${h}/`)) return `~${p.slice(h.length)}`;
  return p;
}

/** @param {string} text */
function tagged(text) {
  return `${TAG}  ${text}${NL}`;
}

/** @param {string[]} paths @param {string} home */
function listPaths(paths, home) {
  const shown = paths.map((p) => displayPath(p, home));
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/**
 * One progress event (from folder-resolve.js / git-clone.js) as terminal text.
 * `clone-progress` redraws its own line in place (`\r`, no newline);
 * `clone-done` ends that line first.
 * @param {{ kind: string, [k: string]: any }} event
 * @param {{ home: string, agent: string }} ctx
 * @returns {string}
 */
export function progressLine(event, ctx) {
  const starting = `Starting ${agentName(ctx.agent)} there.`;
  switch (event.kind) {
    case "looking":
      return tagged(`Looking for ${event.repoName} on this Mac…`);
    case "found": {
      const others = event.alsoFound ?? [];
      if (others.length === 0) {
        return tagged(`Found it: ${displayPath(event.path, ctx.home)}`) + tagged(starting);
      }
      const otherLine =
        others.length === 1
          ? `(The other one is ${displayPath(others[0], ctx.home)}.)`
          : `(The others are ${listPaths(others, ctx.home)}.)`;
      return (
        tagged(`Found ${others.length + 1} copies. Using the one you used most recently: ${displayPath(event.path, ctx.home)}`) +
        tagged(otherLine) +
        tagged(starting)
      );
    }
    case "clone-start":
      return (
        tagged(
          `It isn't on this Mac yet, so it's being downloaded from GitHub (${event.repo.owner}/${event.repo.name}) into ${displayPath(event.dest, ctx.home)}.`,
        ) + tagged("If your Mac asks to use your GitHub sign-in from the keychain, click Always Allow.")
      );
    case "clone-progress":
      return `\r${TAG}  Downloading… ${event.pct}%`;
    case "clone-done":
      return `${NL}${tagged(`Downloaded. ${starting}`)}`;
    case "created":
      return tagged(`This board has no GitHub project yet, so it gets a new folder: ${displayPath(event.path, ctx.home)}`) + tagged(starting);
    default:
      return "";
  }
}

/** @param {string} text */
function yellow(text) {
  return `${YELLOW}${text}${RESET}${NL}`;
}

/**
 * The line(s) written before the bridge stops because the folder couldn't be
 * got ready. `detail` (GitHub's own last error line) goes only into the
 * terminal stream, never into the close reason.
 * @param {{ reason: string, detail?: string | null }} failure
 * @param {{ home: string, agent: string, folder?: string | null, newFolder?: string | null }} ctx
 * @returns {string[]}
 */
export function failureLines(failure, ctx) {
  const { reason, detail } = failure;
  switch (reason) {
    case "folder-missing":
      return [
        yellow(
          `The project folder ${ctx.folder ? displayPath(ctx.folder, ctx.home) : "for this conversation"} isn't on this Mac, so this conversation can't be reopened here.`,
        ),
      ];
    case "clone-no-access":
    case "clone-failed":
      if (detail && detail !== "stalled") return [yellow(`GitHub said: ${detail}`)];
      return [yellow("The download from GitHub stopped before it finished.")];
    case "git-missing":
      return [
        yellow(
          "Git isn't installed yet, so the project can't be downloaded. Your Mac is showing Apple's installer now: click Install (it takes a few minutes), then start again.",
        ),
      ];
    case "folder-unavailable":
      return [yellow(`${ctx.newFolder ? displayPath(ctx.newFolder, ctx.home) : "The project folder"} couldn't be created on this Mac.`)];
    case "folder-lookup-failed":
      return [yellow("The helper on this Mac couldn't reach VibeCodes to look up this project's folder.")];
    case "folder-not-allowed":
      return [yellow("This session won't start in that folder: it isn't a project folder.")];
    default:
      return [yellow("This session couldn't get the project folder ready on this Mac.")];
  }
}

/**
 * The agent quit within seconds of starting, without saying why on screen.
 * @param {string} agent @param {number} exitCode
 */
export function earlyExitLine(agent, exitCode) {
  return yellow(`${agentName(agent)} stopped straight away (exit code ${exitCode}).`);
}

/** @type {Record<string, string>} */
const HOW_WORDS = {
  found: "found an existing copy",
  cloned: "downloaded it",
  created: "created it",
  saved: "this Mac's saved folder",
};

/**
 * Prepended to the launch prompt (locally, never in the launch link) when the
 * bridge chose a folder other than the one the page suggested, so the agent
 * doesn't follow the prompt's own "cd into your clone / git clone" step.
 * @param {{ path: string, how: string }} folder
 */
export function promptFolderNote({ path, how }) {
  return (
    `VibeCodes note: you are already in this board's project folder on this Mac: ${path} (${HOW_WORDS[how] || HOW_WORDS.saved}). ` +
    "Work here. Ignore any other folder or clone instruction below, and don't cd elsewhere."
  );
}

/**
 * Written into the terminal when a resume asked for a conversation that isn't
 * stored on this Mac and a fresh session starts instead (never silent).
 * @param {string} agent
 */
export function freshInsteadOfResumeLine(agent) {
  return tagged(
    `Couldn't find your earlier conversation on this Mac, so this is a fresh ${agentName(agent)} session.`
  );
}
