// Edits to the start-up message (the launch prompt) the helper makes locally,
// after the deep link has been parsed (card 5e654dd1, stage 15).
//
// The helper saves the project folder itself before the agent starts, so the
// numbered "Re-confirm the folder ... call record_project_path" step is
// redundant once that save is confirmed. Pure function; src/lib/terminal/
// launch-prompt.drift.test.ts runs it over the app's real prompt builders so a
// wording change there can't silently stop the step being recognised.

/** The numbered folder-record step, normal and packed forms (em dash or semicolon). */
const FOLDER_RECORD_LINE = /^(\d+)\. Re-confirm the folder \(never [^)]*\): call record_project_path\b[^\n]*$/;
const NUMBERED = /^(\d+)\. /;

/**
 * Remove the one numbered record_project_path step and renumber the steps
 * after it so the list runs 1..n with no gap. Everything else is left
 * byte-identical. A prompt without the step comes back unchanged.
 * @param {string} prompt
 * @returns {string}
 */
export function withoutFolderRecordStep(prompt) {
  if (typeof prompt !== "string" || !prompt.includes("record_project_path")) return prompt;
  const lines = prompt.split("\n");
  const at = lines.findIndex((l) => FOLDER_RECORD_LINE.test(l));
  if (at < 0) return prompt;
  let previous = Number(lines[at].match(NUMBERED)[1]);
  const out = lines.slice(0, at);
  let renumbering = true;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i];
    const m = renumbering ? line.match(NUMBERED) : null;
    if (m && Number(m[1]) === previous + 1) {
      previous = Number(m[1]);
      out.push(`${previous - 1}. ${line.slice(m[0].length)}`);
    } else {
      if (m) renumbering = false;
      out.push(line);
    }
  }
  return out.join("\n");
}
