// Terminal session rename — code-point-safe input handling (card 3bf262ac,
// Design Review's binding implementation note 1): the design's own claim
// that HTML `maxLength={100}` enforces the 100-character limit is wrong —
// `maxLength` counts UTF-16 CODE UNITS, not Unicode code points. A name with
// astral-plane emoji (each one 2 UTF-16 units, 1 code point — see the
// worked-example table's "🚀 Ship the launch page" case) would let the
// browser accept fewer *visible* characters than the 100 the server allows,
// or — worse — let `.slice()`/`.length`-based client logic split a surrogate
// pair and send a mangled character. Every place that clamps or measures a
// display name (the rename input's onChange handler, its live counter, and
// the PATCH route's server-side enforcement) must go through these two
// helpers instead of raw `string.length`/`.slice()`, so client and server
// agree on what "100" means.

export const DISPLAY_NAME_MAX_CODE_POINTS = 100;

/** The live counter (design §4) appears once a name reaches this length — communicated before the wall, never only at it. */
export const DISPLAY_NAME_COUNTER_THRESHOLD = 80;

/** Length in Unicode CODE POINTS, not UTF-16 units — `"🚀".length === 2` but `codePointLength("🚀") === 1`. */
export function codePointLength(value: string): number {
  // Spreading a string iterates by code point (surrogate pairs combine into
  // one element), unlike `.length` or `.split("")`.
  return [...value].length;
}

/** Clamps to at most `max` code points, never slicing a surrogate pair in half. */
export function clampToCodePoints(value: string, max: number = DISPLAY_NAME_MAX_CODE_POINTS): string {
  const chars = [...value];
  return chars.length <= max ? value : chars.slice(0, max).join("");
}

/**
 * Normalizes a rename request's raw `displayName` field into what the
 * database should store: trimmed, clamped to the code-point limit, and —
 * critically — an empty or whitespace-only value becomes `null`, never
 * `""`. A save with a blank field is how the rename UI clears back to the
 * auto-name (design §4 "Clear"); storing `""` instead of `null` would make
 * `resolveSessionName` see a technically-non-null-but-empty user name and
 * behave unpredictably depending on how each caller checks for "unset".
 */
export function normalizeDisplayNameInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return clampToCodePoints(trimmed, DISPLAY_NAME_MAX_CODE_POINTS);
}
