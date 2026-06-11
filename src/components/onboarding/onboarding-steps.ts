/**
 * Counted onboarding sequence (5 steps). The "creating" loading view and the
 * "board ready" recap are sub-states of the Project step and are NOT counted.
 *
 *   0 Welcome · 1 Profile · 2 Project · 3 Connect · 4 Done
 *
 * Internal `step` state values used by the dialog:
 *   0 Welcome · 1 Profile · 2 Project(form/creating) · 3 Board-ready recap ·
 *   4 Connect · 5 Done
 */
export const TOTAL_STEPS = 5;

/** Map the internal `step` state to the counted indicator index (0-based). */
export function indicatorIndex(step: number): number {
  switch (step) {
    case 0:
      return 0; // Welcome
    case 1:
      return 1; // Profile
    case 2:
    case 3:
      return 2; // Project (form / creating / board-ready recap)
    case 4:
      return 3; // Connect Claude Code
    case 5:
      return 4; // Done
    default:
      return 0;
  }
}
