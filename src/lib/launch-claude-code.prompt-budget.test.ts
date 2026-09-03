import { describe, it, expect } from "vitest";
import {
  buildBoundedDeepLink,
  buildCompactPromptEssentials,
  formEncodedLength,
  slugifyIdeaTitle,
  DEFAULT_NEW_PROJECT_PARENT,
} from "./launch-claude-code";
import { buildLaunchDeepLink, MAX_LAUNCH_URL_LENGTH } from "./terminal/deep-link";
import { parseLaunchDeepLink } from "../../terminal/shared/deep-link.mjs";

// ── Nick, 3 Sep 2026: a task-card "Launch in browser" lost its task ──────────
// On the "My favourite things ranking app" board, a launch that went out in
// NEW-PROJECT mode (the page's folder snapshot was stale — see
// launch-claude-code-button.tsx's resolveFreshLaunch) carried BOTH tokens and
// hit the 2048-char cap so hard that assembleAtomicTail fell to its
// head-only rung: three setup steps and no "Work this task" line at all. The
// agent then went looking for work and picked a different card.
//
// These tests pin the REAL shapes end to end — the vibecodes:// link exactly
// as use-terminal-session.ts builds it (same param set, same `+`-space prompt
// encoding, same measurer) — and document the two levers that fix it:
//  1. `+`-encoded spaces (encodePromptParam) — ~340 chars back on every link.
//  2. Dropping the optional helperToken (~290 chars) when the work step would
//     otherwise be lost (fireLaunchDeepLink's promptCarriesWorkStep check).

const relay = "wss://vibecodes-terminal-relay.nickball.workers.dev";
const session = "49a09772-5836-47e5-af25-1bea6dc045f4";
const realToken = "x".repeat(283); // measured length of a real HMAC-signed token
const ideaId = "a4105af9-e1e0-4d5b-94ab-1c3e20ea4522";
const taskId = "ab7a7231-0b7c-47f6-921d-004551b6e51f";
const APP_URL = "https://vibecodes.co.uk";
type Essentials = ReturnType<typeof buildCompactPromptEssentials>;

/** Exactly what use-terminal-session.ts's fresh-launch buildLink closure fires. */
function realBrowserLink(helperToken: string | undefined) {
  return (parts: { prompt: string; cwd?: string }): string =>
    buildLaunchDeepLink({
      relay,
      session,
      token: realToken,
      helperToken,
      cwd: parts.cwd,
      prompt: parts.prompt,
      cols: 213,
      rows: 33,
      model: "claude-sonnet-5",
      permissionMode: "auto",
    });
}

function build(essentials: Essentials, cwd: string, helperToken: string | undefined) {
  return buildBoundedDeepLink({
    essentials,
    cwd,
    cap: MAX_LAUNCH_URL_LENGTH,
    promptKeyOverhead: "&prompt=".length,
    cwdPolicy: "keep",
    promptMeasure: formEncodedLength,
    buildLink: realBrowserLink(helperToken),
  });
}

function promptOf(result: ReturnType<typeof buildBoundedDeepLink>): string {
  if (!result.ok) return "";
  return parseLaunchDeepLink(result.url)?.prompt ?? "";
}

/** Every head step, the FULL work step and `cwd=` all ride, with `minHeadroom` to spare. */
function expectWholePrompt(
  result: ReturnType<typeof buildBoundedDeepLink>,
  essentials: Essentials,
  cwd: string,
  minHeadroom: number
) {
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.droppedCwd).toBe(false);
  expect(result.url.length).toBeLessThanOrEqual(MAX_LAUNCH_URL_LENGTH);
  expect(MAX_LAUNCH_URL_LENGTH - result.url.length).toBeGreaterThanOrEqual(minHeadroom);
  const parsed = parseLaunchDeepLink(result.url);
  expect(parsed?.cwd).toBe(cwd);
  const prompt = parsed?.prompt ?? "";
  for (const step of essentials.headSteps ?? []) expect(prompt).toContain(step);
  expect(prompt).toContain(essentials.work as string);
  expect(prompt).not.toContain("…(truncated)");
}

function newProjectShape(title: string): { essentials: Essentials; cwd: string } {
  const slug = slugifyIdeaTitle(title);
  return {
    cwd: `/Users/nickball/projects/${slug}`,
    essentials: buildCompactPromptEssentials({
      appUrl: APP_URL,
      ideaId,
      ideaTitle: title,
      mode: "new",
      repoUrl: null,
      newProject: { newProjectPath: `${DEFAULT_NEW_PROJECT_PARENT}/${slug}` },
      taskId,
    }),
  };
}

describe("in-browser launch prompt budget — the 3 Sep 2026 task-launch shape", () => {
  const REPRO_TITLE = "My favourite things ranking app";

  it("REPRO shape (new-project + task + BOTH tokens): with `+`-encoded spaces the FULL work step and the folder now fit", () => {
    const { essentials, cwd } = newProjectShape(REPRO_TITLE);
    const result = build(essentials, cwd, realToken);
    expectWholePrompt(result, essentials, cwd, 0);
    const prompt = promptOf(result);
    expect(prompt).toContain(`get_task (task_id ${taskId}, idea_id ${ideaId})`);
    expect(prompt).toContain("move it to In Progress, then start. Comment as you go.");
  });

  it("REPRO shape measured the OLD way (%20 spaces) is on the knife-edge — the encoding IS the headroom", () => {
    const { essentials, cwd } = newProjectShape(REPRO_TITLE);
    const legacyLink = (parts: { prompt: string; cwd?: string }) =>
      realBrowserLink(realToken)(parts).replace(/\+/g, "%20");
    const legacy = buildBoundedDeepLink({
      essentials,
      cwd,
      cap: MAX_LAUNCH_URL_LENGTH,
      promptKeyOverhead: "&prompt=".length,
      cwdPolicy: "keep",
      buildLink: legacyLink,
    });
    const fixed = build(essentials, cwd, realToken);
    expect(legacy.ok && fixed.ok).toBe(true);
    if (!legacy.ok || !fixed.ok) return;
    const everything = [...(essentials.headSteps ?? []), essentials.work as string];
    // The old encoding had to drop something at this shape (in the field it
    // was the record_project_path step, then the work step); the new one
    // carries every step whole in a link that's still under the cap.
    const legacyPrompt = decodeURIComponent(legacy.url.split("&prompt=")[1] ?? "");
    expect(everything.every((s) => legacyPrompt.includes(s))).toBe(false);
    const fixedPrompt = promptOf(fixed);
    expect(everything.every((s) => fixedPrompt.includes(s))).toBe(true);
    // And the same content costs ~2 chars less per space on the wire.
    const spaces = fixedPrompt.split(" ").length - 1;
    expect(spaces).toBeGreaterThan(100);
    expect(encodeURIComponent(fixedPrompt).length - formEncodedLength(fixedPrompt)).toBe(2 * spaces);
  });

  it("WORST shape (80-char title, new-project, task) loses the work step WITH the helper token — and keeps it WITHOUT (why fireLaunchDeepLink drops the token)", () => {
    const { essentials, cwd } = newProjectShape(
      "A".repeat(80) + " extra words past the eighty char header cap"
    );
    const withHelper = build(essentials, cwd, realToken);
    expect(withHelper.ok).toBe(true);
    // Documented, not desired: at this shape the work step can't ride
    // alongside two 283-char tokens even with `+` encoding …
    expect(promptOf(withHelper)).not.toContain(essentials.work as string);
    // … which is exactly the condition fireLaunchDeepLink rebuilds on. The
    // helper-token-less link carries everything, with real headroom.
    const withoutHelper = build(essentials, cwd, undefined);
    expectWholePrompt(withoutHelper, essentials, cwd, 150);
  });

  it("existing-folder mode with a task: the full work step rides; the directory echo rides once the helper token is gone", () => {
    const cwd = "/Users/nickball/projects/favourites";
    const essentials = buildCompactPromptEssentials({
      appUrl: APP_URL,
      ideaId,
      ideaTitle: REPRO_TITLE,
      mode: "existing",
      repoUrl: null,
      existingPath: cwd,
      taskId,
    });
    const withHelper = build(essentials, cwd, realToken);
    expectWholePrompt(withHelper, essentials, cwd, 0);
    const withoutHelper = build(essentials, cwd, undefined);
    expectWholePrompt(withoutHelper, essentials, cwd, 150);
    expect(promptOf(withoutHelper)).toContain(essentials.directoryEcho as string);
  });

  it("never fires %20 for a space — every space in the prompt rides as a single `+`", () => {
    const { essentials, cwd } = newProjectShape(REPRO_TITLE);
    const result = build(essentials, cwd, realToken);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const promptParam = result.url.split("&prompt=")[1] ?? "";
    expect(promptParam).not.toContain("%20");
    expect(promptParam.split("+").length - 1).toBe(promptOf(result).split(" ").length - 1);
  });
});
