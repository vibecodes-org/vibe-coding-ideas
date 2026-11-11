// In-app setup for Claude Code and Codex (card 63a60792, stage 1).
//
// A "setup" session is a short bridge session that runs ONLY one of the fixed
// commands below: the maker's own installer, or the agent's own sign-in. The
// launch link carries just `setup=install|signin|signin-code` plus `agent`;
// every command, address and folder lives HERE, never in the link, so a forged
// link can't make the helper run anything but these. The bridge also spawns
// only after the relay has confirmed the owner-bound token (the same gate as a
// prompt launch).
//
// Pure: no spawning here. `checkSignedIn` takes an injectable runner so the
// status checks are unit-tested without a real agent or a real sign-in.
//
// The install addresses and install lines are the ONE table the bridge's
// "isn't installed" banner (agent-copy.js) also reads. The app keeps a typed
// copy in src/lib/terminal/agent-install.ts; a drift test pins the two.

/** @typedef {"claude"|"codex"} SetupAgent */
/** @typedef {"install"|"signin"|"signin-code"} SetupAction */

/** @type {Record<SetupAgent, string>} */
export const AGENT_DISPLAY_NAMES = Object.freeze({ claude: "Claude Code", codex: "Codex" });

/** Each maker's current install page (opened in a real browser 11 Nov 2026). */
export const AGENT_INSTALL_GUIDE_URLS = Object.freeze({
  claude: "https://code.claude.com/docs/en/setup",
  codex: "https://learn.chatgpt.com/docs/codex/cli",
});

/** The exact line each maker's own website tells you to paste. Shown to the
 *  user before they click, copied by "Copy the command", and run (through the
 *  shell named in INSTALL_SHELL) by one-click install. */
export const AGENT_INSTALL_COMMANDS = Object.freeze({
  claude: "curl -fsSL https://claude.ai/install.sh | bash",
  codex: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
});

/** The shell that runs each install line (the one the maker's line pipes into). */
const INSTALL_SHELL = Object.freeze({ claude: "/bin/bash", codex: "/bin/sh" });

/** The only values the launch link's `setup` may take. */
export const SETUP_ACTION_NAMES = Object.freeze(["install", "signin", "signin-code"]);

/** How long a sign-in status check may take before it counts as "unknown". */
export const STATUS_CHECK_TIMEOUT_MS = 10_000;

/**
 * The fixed command for a setup action, or null when the combination isn't
 * allowed (an unknown agent/action, `signin-code` for Claude, or a sign-in with
 * no resolved binary). Nothing from the launch link goes into it.
 * @param {string} agent
 * @param {string} action
 * @param {string | null} [binaryPath] absolute path of the agent (sign-in only)
 * @returns {{ file: string, args: string[] } | null}
 */
export function setupCommand(agent, action, binaryPath = null) {
  if (agent !== "claude" && agent !== "codex") return null;
  if (action === "install") {
    return { file: INSTALL_SHELL[agent], args: ["-c", AGENT_INSTALL_COMMANDS[agent]] };
  }
  if (typeof binaryPath !== "string" || binaryPath.length === 0) return null;
  if (action === "signin") {
    return { file: binaryPath, args: agent === "claude" ? ["auth", "login"] : ["login"] };
  }
  if (action === "signin-code" && agent === "codex") {
    return { file: binaryPath, args: ["login", "--device-auth"] };
  }
  return null;
}

const GREY = "\x1b[90m";
const RESET = "\x1b[0m";

/**
 * The VibeCodes lines written above the installer's or the sign-in's own
 * output (mock sections 2 and 4). Plain English, CRLF line endings.
 * @param {SetupAgent} agent
 * @param {SetupAction} action
 * @returns {string}
 */
export function setupIntroLines(agent, action) {
  const name = AGENT_DISPLAY_NAMES[agent] || agent;
  const maker = agent === "codex" ? "OpenAI's" : "Anthropic's";
  if (action === "install") {
    return (
      `${GREY}VibeCodes${RESET}  Installing ${name} with ${maker} installer.\r\n` +
      `${GREY}VibeCodes${RESET}  Running: ${AGENT_INSTALL_COMMANDS[agent]}\r\n\r\n`
    );
  }
  return `${GREY}VibeCodes${RESET}  Signing in to ${name}. Finish on the page that just opened in your browser.\r\n\r\n`;
}

/**
 * Ask the agent whether it is signed in. true / false, or null when the answer
 * can't be read (timeout, odd output, an error) so setup never blocks on a
 * check it can't read.
 *   claude: `claude auth status --json` -> { loggedIn: boolean }
 *   codex:  `codex login status` -> exit 0 signed in, exit 1 not signed in
 * @param {SetupAgent} agent
 * @param {{ binary: string, env?: NodeJS.ProcessEnv, run: (file: string, args: string[], opts: { env?: NodeJS.ProcessEnv, timeoutMs: number }) => { status: number | null, stdout?: string, error?: unknown, timedOut?: boolean } }} deps
 * @returns {boolean | null}
 */
export function checkSignedIn(agent, { binary, env, run }) {
  if (!binary) return null;
  let res;
  try {
    res = run(
      binary,
      agent === "claude" ? ["auth", "status", "--json"] : ["login", "status"],
      { env, timeoutMs: STATUS_CHECK_TIMEOUT_MS },
    );
  } catch {
    return null;
  }
  if (!res || res.error || res.timedOut) return null;
  if (agent === "codex") {
    if (res.status === 0) return true;
    if (res.status === 1) return false;
    return null;
  }
  try {
    const parsed = JSON.parse(String(res.stdout ?? "").trim());
    if (parsed && parsed.loggedIn === true) return true;
    if (parsed && parsed.loggedIn === false) return false;
  } catch {
    /* unreadable: unknown */
  }
  return null;
}

/** @param {unknown} code */
function safeCode(code) {
  return Number.isInteger(code) && /** @type {number} */ (code) >= 0 && /** @type {number} */ (code) < 256
    ? /** @type {number} */ (code)
    : 0;
}

/**
 * How a setup session ends, as the end reason the page reads (fits the relay's
 * [A-Za-z0-9:._-] reason pattern, so no relay change is needed).
 * @param {{ action: SetupAction, found: boolean, signedIn: boolean | null, exitCode?: number | null }} input
 *   found: the agent is on this Mac now (after an install); signedIn: result of checkSignedIn
 * @returns {string}
 */
export function setupEndReason({ action, found, signedIn, exitCode }) {
  if (action === "install") {
    if (!found) return `setup-install-failed:${safeCode(exitCode)}`;
    return signedIn === true ? "setup-signed-in" : "setup-installed";
  }
  if (signedIn === false) return `setup-signin-failed:${safeCode(exitCode)}`;
  return "setup-signed-in";
}

/**
 * The one VibeCodes line written when a setup session finishes well (mock
 * sections 3 and 5). Empty for a failure: the page explains that itself.
 * @param {SetupAgent} agent
 * @param {string} reason a setupEndReason value
 * @returns {string}
 */
export function setupOutroLines(agent, reason) {
  const name = AGENT_DISPLAY_NAMES[agent] || agent;
  if (reason === "setup-installed") return `\r\n${GREY}VibeCodes${RESET}  ${name} is installed.\r\n`;
  if (reason === "setup-signed-in") return `\r\n${GREY}VibeCodes${RESET}  Signed in to ${name}.\r\n`;
  return "";
}
