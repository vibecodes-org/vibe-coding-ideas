// Desktop Codex: build the launch SCRIPT the helper writes to disk and hands
// to `open -a Terminal` (Codex support, docs/codex-terminal-requirements.md
// FR-11/FR-12/FR-13, UX design §12b/§12c, spike S-4's recommended mechanism —
// "option 1: launch script + `open`", no Automation-permission prompt).
//
// Pure, dependency-free string-building only — no fs/child_process here, so
// the QUOTING is unit-testable (AC-19b: "a pure function unit-tested for
// quoting — single quotes, $, backticks, newlines, # characters") without
// ever touching disk or spawning Terminal.app. main.js does the I/O: writing
// this text to a 0700, unguessably-named `.command` file and running `open`.
//
// SAFETY PROPERTIES this script enforces (security note, FR-11, AC-19):
//   1. Only the FIXED binary `codex` is ever exec'd — never a caller-supplied
//      command string.
//   2. The folder shown to the user is the shell's OWN `pwd` AFTER `cd`, never
//      echoed from the link — `cd` either lands somewhere real or the script
//      fails loudly and runs nothing else (never a window in the wrong
//      folder, never a silent fallback to $HOME).
//   3. The prompt reaches `codex` as exactly ONE argv element — never
//      shell-split, never string-concatenated into a command line the shell
//      re-parses. Delivered via a single-quoted heredoc (so `$`, backticks,
//      and quotes inside it are inert — no expansion happens while reading
//      the heredoc body) into a shell variable, then passed as `"$PROMPT"`
//      (double-quoted expansion — word-splitting/globbing suppressed, and a
//      shell does not re-interpret `$`/backticks that are already IN a
//      variable's value during expansion, only during the original read).
//   4. The S-5 safeguard: the script prints what is about to run and BLOCKS
//      on a real keypress (`read`) before the `exec codex` line is ever
//      reached — closing the window or Ctrl+C exits with nothing run
//      (AC-19, AC-17).
//   5. Self-deletes (`rm -f -- "$0"`) as its very first action, before
//      printing anything or touching the network — the on-disk copy is
//      needed only for the shell to begin reading/executing it (see FR-11's
//      "removed after Terminal has started it"); main.js ALSO sweeps its own
//      temp dir on next helper start as a safety net for a script that never
//      got the chance to run at all (a crashed helper, a window that was
//      never opened because a later pre-flight check failed).
//
// LIVE VERIFICATION NEEDED (S-4, AC-14/15/17): whether Terminal.app's own
// invocation of a `.command` file preserves `$0` for the self-delete line,
// and whether the window-title escape sequence renders as expected, are
// UNVERIFIED here — this environment has no macOS Terminal.app. Nick's
// sign-off must exercise this for real (see the implementation report).
//
// SECURITY FIX (Finding 2 — HIGH, terminal-escape injection via the displayed
// prompt): the link's `prompt` reaches this builder URL-decoded, so a
// hostile prompt can contain raw control bytes — ESC (0x1b) above all, which
// can redraw/erase arbitrary parts of the terminal, INCLUDING the "if you
// didn't just click Launch in VibeCodes, close this window" warning right
// below the echoed prompt (safety property 4's whole point). `echo "$PROMPT"`
// used to print the prompt completely raw. Now the script echoes a SEPARATE,
// SANITIZED `PROMPT_DISPLAY` (built by `sanitizePromptForDisplay` below,
// still in this pure builder so it stays unit-testable) — every C0 control
// byte except newline, DEL, and every C1 byte is replaced with `?` before it
// ever reaches a heredoc. The RAW `$PROMPT` is completely unchanged and is
// still exactly what `exec codex "$PROMPT"` receives — sanitization is a
// DISPLAY-ONLY concern; codex must see the prompt byte-for-byte, same as
// before this fix.

import crypto from "node:crypto";

/**
 * Neutralize terminal control bytes in text that is about to be ECHOED to
 * the review screen (Finding 2 fix) — never used on the copy handed to
 * `codex`. Replaces every C0 control byte (0x00-0x1F) except `\n` (0x0A,
 * kept literal so a multi-line prompt still previews on multiple lines —
 * newlines cannot redraw/erase anything, unlike ESC or CR), DEL (0x7F), and
 * every C1 byte (0x80-0x9F) with `?`. `\r` (0x0D) is included in the C0
 * strip range — a bare CR is exactly the "overwrite this line" primitive the
 * review screen must never let hostile input wield.
 * @param {string} prompt
 * @returns {string}
 */
export function sanitizePromptForDisplay(prompt) {
  const text = typeof prompt === "string" ? prompt : "";
  // eslint-disable-next-line no-control-regex -- the whole point is matching control bytes
  return text.replace(/[\x00-\x09\x0b-\x1f\x7f\x80-\x9f]/g, "?");
}

/**
 * Single-quote a string for safe interpolation into a POSIX shell command
 * line: wraps it in `'...'` and escapes any embedded `'` as `'\''` (close
 * quote, literal quote, reopen quote) — the standard, fully general technique
 * that needs no knowledge of what characters the string contains.
 * @param {string} value
 * @returns {string}
 */
export function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * A heredoc delimiter that cannot plausibly collide with a line of real
 * prompt content — random by default (the real caller never needs
 * determinism), injectable for tests. Prefixed/suffixed so it can never be
 * mistaken for ordinary prompt text even if guessed.
 * @param {{ randomBytesImpl?: typeof crypto.randomBytes }} [opts]
 * @returns {string}
 */
export function randomHeredocDelimiter(opts = {}) {
  const randomBytesImpl = opts.randomBytesImpl || crypto.randomBytes;
  return `VIBECODES_PROMPT_${randomBytesImpl(12).toString("hex")}`;
}

/** An unguessable `.command` filename for the temp launch script (FR-11 hygiene). */
export function randomScriptFilename(opts = {}) {
  const randomBytesImpl = opts.randomBytesImpl || crypto.randomBytes;
  return `vibecodes-codex-${randomBytesImpl(16).toString("hex")}.command`;
}

const WINDOW_TITLE = "Codex · VibeCodes";

/**
 * Build the full launch-script text. Never touches disk — returns a string.
 *
 * @param {{ cwd: string, prompt: string, pathFallbackSnippet: string,
 *           heredocDelimiter?: string }} args
 *   `cwd` — the folder to `cd` into (single-quoted verbatim; may itself
 *     contain any character, including a single quote — see shellSingleQuote).
 *   `prompt` — the exact text Codex should receive as its ONE positional
 *     argument (may contain quotes, `$`, backticks, newlines, `#`, anything).
 *   `pathFallbackSnippet` — the `export PATH=…` line from
 *     terminal/shared/spawn-path.mjs's `pathFallbackShellSnippet()`, so this
 *     window finds `codex` in the same well-known places the bridge does
 *     (FR-11) without duplicating that list here.
 *   `heredocDelimiter` — injectable for deterministic tests; a fresh random
 *     one is generated per real launch (see randomHeredocDelimiter above).
 *   `displayHeredocDelimiter` — same, for the SANITIZED display copy's own
 *     heredoc (kept distinct from `heredocDelimiter` — a fresh random pair
 *     is generated per real launch so they can never collide).
 * @returns {string}
 */
export function buildOpenTerminalScript({ cwd, prompt, pathFallbackSnippet, heredocDelimiter, displayHeredocDelimiter }) {
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw new TypeError("buildOpenTerminalScript requires a non-empty cwd");
  }
  const delimiter = heredocDelimiter || randomHeredocDelimiter();
  const displayDelimiter = displayHeredocDelimiter || randomHeredocDelimiter();
  const promptText = typeof prompt === "string" ? prompt : "";
  // Finding 2 fix: the DISPLAY copy is sanitized; the raw copy below (fed to
  // `exec codex`) is untouched. Line count is taken from the display copy —
  // sanitizePromptForDisplay never adds/removes newlines, so it's identical
  // to counting the raw prompt, but this way the number on screen always
  // matches exactly what's echoed under it.
  const promptDisplay = sanitizePromptForDisplay(promptText);
  const lineCount = promptDisplay.length === 0 ? 0 : promptDisplay.split("\n").length;

  return `#!/bin/bash
# VibeCodes — temporary Codex launch script. Self-deletes immediately; if you
# are reading this file, something went wrong before it could run.
rm -f -- "$0"
set -f
printf '\\033]0;%s\\007' ${shellSingleQuote(WINDOW_TITLE)}
${pathFallbackSnippet}

cd -- ${shellSingleQuote(cwd)} || {
  echo "Couldn't open the project folder — it may have moved or been deleted."
  echo "Nothing was started. You can close this window."
  read -r -p "" _ignored
  exit 1
}
FOLDER="$(pwd)"

PROMPT=$(cat <<'${delimiter}'
${promptText}
${delimiter}
)

PROMPT_DISPLAY=$(cat <<'${displayDelimiter}'
${promptDisplay}
${displayDelimiter}
)

echo "VibeCodes · Open Codex here?"
echo
echo "Folder   $FOLDER"
echo
if [ ${lineCount} -gt 0 ]; then
  echo "Codex will start with this message (${lineCount} lines):"
  echo "$PROMPT_DISPLAY" | sed 's/^/  | /'
  echo
fi
echo "Press Enter to start Codex, or close this window to do nothing."
echo "If you didn't just click Launch in VibeCodes, close this window."

trap 'echo; echo "Nothing was started. You can close this window."; exit 130' INT
read -r _start
echo "Starting Codex in $FOLDER..."
if [ -n "$PROMPT" ]; then
  exec codex "$PROMPT"
else
  exec codex
fi
`;
}

export { WINDOW_TITLE };
