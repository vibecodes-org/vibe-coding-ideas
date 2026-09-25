// Auto-switch to the configured backup model when the primary is unavailable
// (card 5d0665a2). Pure decision logic only — no Supabase, no I/O — so every
// rule below is unit-testable without a database or a live claim.
//
// WHY THIS IS SHAPED THE WAY IT IS. VibeCodes never calls the model. Workflow
// steps run as Task-tool subagents (Claude) or fresh spawned processes
// (Codex) inside Claude Code or Codex on the user's own machine; the MCP
// server hands out an instruction and later records what the orchestrator
// SAYS came back. There is therefore no server-side try/catch that could
// catch an "out of credits" error and retry the call — by the time VibeCodes
// hears about it, the step is already over.
//
// So "auto-switch" here means the two things the server genuinely controls:
//   1. Re-issue the step that died, directed at the backup (shouldRescueStep).
//   2. Stop aiming later steps at a model we have same-day evidence is dead
//      (applyModelAvailability, driven by a live marker).
//
// Everything here keys off self-reported data and is therefore advisory in
// the same sense the rest of the tier machinery is. That is a known ceiling,
// not an oversight — see the card.

/** Resolution produced by resolveModelTier: the directed model and its configured backup. */
export interface TierResolution {
  resolved: string;
  fallback: string;
}

/**
 * Cool-off window (Nick, 4 Sep 2026, reconfirmed 25 Sep): a marker lives
 * until midnight UTC, so the primary is tried again the following day.
 *
 * Deliberately UTC, not the viewer's local midnight: `users` stores no
 * timezone, and inventing one per call would make the same marker expire at
 * different instants for the app, the MCP server and a test. For a UK user
 * that means the reset lands at midnight GMT / 1am BST — within an hour of
 * the intended "next day" either way, which is well inside the tolerance of
 * a mechanism whose whole job is to ride out a credit top-up.
 */
export function isMarkerLive(markedAt: Date | string | null | undefined, now: Date): boolean {
  if (!markedAt) return false;
  const marked = markedAt instanceof Date ? markedAt : new Date(markedAt);
  if (Number.isNaN(marked.getTime())) return false;
  // A clock skew or a bad row must never mark a model dead into the future.
  if (marked.getTime() > now.getTime()) return false;
  return (
    marked.getUTCFullYear() === now.getUTCFullYear() &&
    marked.getUTCMonth() === now.getUTCMonth() &&
    marked.getUTCDate() === now.getUTCDate()
  );
}

/** The inclusive lower bound for "marked today" — the DB-side half of isMarkerLive. */
export function markerWindowStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export interface AppliedAvailability {
  /** The model the step should actually be directed at. */
  directed: string;
  /** The model to name as the next resort if `directed` also fails. */
  fallback: string;
  /** True when we swapped away from the tier's normal model because of a live marker. */
  switched: boolean;
  /** The model we swapped AWAY from — null unless `switched`. */
  unavailable: string | null;
}

/**
 * Applies a live unavailability marker to a tier resolution.
 *
 * Only ever swaps when the marker names the model this tier would otherwise
 * direct at. A marker for a model this tier doesn't use is not evidence about
 * this tier — a user whose `cheap` tier died has no reason to lose `frontier`,
 * and a Codex failure on `frontier` is no reason to move Claude's `frontier`
 * (the marker stores the concrete model, so the two never collide even when
 * both agents happen to name the same tier).
 *
 * Never swaps onto the dead model: if the configured backup IS the model
 * that failed (the seed chain is deliberately reciprocal — fable->opus,
 * opus->fable — so this is reachable, not theoretical), there is nowhere
 * better to go, so the resolution is returned untouched and the directive
 * keeps today's advisory wording rather than confidently sending work to a
 * model we know is down.
 */
export function applyModelAvailability(
  resolution: TierResolution,
  unavailableModel: string | null | undefined
): AppliedAvailability {
  const { resolved, fallback } = resolution;
  const noSwitch: AppliedAvailability = { directed: resolved, fallback, switched: false, unavailable: null };

  if (!unavailableModel) return noSwitch;
  if (unavailableModel !== resolved) return noSwitch;
  if (fallback === resolved) return noSwitch;
  if (fallback === unavailableModel) return noSwitch;

  // Directed at the backup, and the backup's own next resort is the primary:
  // if credits came back mid-day, the orchestrator's own advisory line lets
  // it return there without waiting for the marker to expire (Requirements
  // §4 — the swapped fallback sentence is deliberate, not a bug).
  return { directed: fallback, fallback: resolved, switched: true, unavailable: unavailableModel };
}

/**
 * The notice prepended to the MANDATORY MODEL directive when a switch is in
 * force (AC-3, UX Design §1). Returns "" when nothing was switched, so
 * callers can concatenate unconditionally and the happy-path directive stays
 * byte-for-byte identical to what it was before this feature (AC-6).
 *
 * Says WHY as well as WHAT: an orchestrator that reads "run on opus" with no
 * reason has every incentive to second-guess it against a CLAUDE.md that
 * still says frontier means fable. Wording is verbatim from the approved
 * design doc (docs/workflow-model-autoswitch-directive-wording.html §1).
 */
export function modelSwitchNotice(applied: AppliedAvailability): string {
  if (!applied.switched || !applied.unavailable) return "";
  return (
    `MODEL SWITCH: "${applied.unavailable}" was reported unavailable on this board earlier today ` +
    `(credits, overload, rate limit, or not on this plan), so this step is directed at the configured ` +
    `backup "${applied.directed}" instead. This is deliberate and current; follow it. The switch lapses ` +
    `at midnight UTC, when "${applied.unavailable}" is tried again automatically.`
  );
}

export interface RescueDecision {
  /** Return the step to pending so the next claim re-issues it on the backup. */
  rescue: boolean;
  /** Why — for the step comment and the ops log. */
  reason: "rescued" | "already-rescued" | "not-a-model-failure";
}

/**
 * Whether a failing step should be handed straight back out instead of being
 * left failed (AC-1).
 *
 * `alreadyRescued` is whether this step's OWN model_unavailable_at was
 * already set, read from the row as it stood BEFORE this write — true means
 * this step has already been auto-rescued once, EVER (not just today). The
 * guard is the whole reason the flag is read before it is written: without
 * it, a step whose real problem is something other than credits (a broken
 * repo, a bad prompt) would bounce between pending and failed indefinitely,
 * burning a model call every lap and never surfacing to a human.
 */
export function shouldRescueStep(
  modelUnavailableReported: boolean | undefined,
  alreadyRescued: boolean | null | undefined
): RescueDecision {
  if (!modelUnavailableReported) return { rescue: false, reason: "not-a-model-failure" };
  if (alreadyRescued) return { rescue: false, reason: "already-rescued" };
  return { rescue: true, reason: "rescued" };
}

/**
 * The free signal (AC-4). An orchestrator that obeyed the existing advisory
 * line and substituted the backup has already told us the primary was
 * unavailable — it reports `model_used` = the fallback. No new parameter, no
 * extra cooperation, and it works retroactively for any orchestrator already
 * following the directive today.
 *
 * `resolution` must be the tier's normal, UNSWITCHED resolution (Design
 * Review note 1) — comparing against an already-switched pair would infer
 * unavailability backwards and mark the backup dead instead of the primary.
 *
 * Requires a tier (an Auto step promised nothing, so a differing model there
 * is a free choice, not evidence) and a real difference between the two.
 */
export function inferUnavailableFromSubstitution(
  tier: string | null | undefined,
  resolution: TierResolution | null,
  modelUsed: string | null | undefined
): boolean {
  if (!tier || !resolution || !modelUsed) return false;
  if (modelUsed === "unknown" || modelUsed === "other") return false;
  if (resolution.fallback === resolution.resolved) return false;
  return modelUsed === resolution.fallback;
}

/**
 * The step comment posted when a step is auto-rescued onto the backup
 * (UX Design §3, box "3a", with the Design-Review-approved wording change:
 * only steps that would have used the dead model move, not "every other
 * step"). Verbatim from the approved design doc.
 */
export function rescueSentence(unavailableModel: string, backupModel: string): string {
  return (
    `**Switched to the backup model.** This step couldn't run because **${unavailableModel}** was unavailable ` +
    `(for example out of credits or overloaded). It has been put back in the queue and will be re-run on the ` +
    `backup, **${backupModel}**. Other steps on this board that would have used **${unavailableModel}** will ` +
    `use **${backupModel}** too until midnight UTC, when **${unavailableModel}** is tried again. This automatic ` +
    `retry happens once per step — if it fails on **${backupModel}** as well it stays failed and needs a person ` +
    `to look.`
  );
}

/**
 * The step comment posted alongside the normal failure comment when a
 * previously-rescued step fails a second time (UX Design §3, box "3b").
 * `model` is the model this claim was ACTUALLY directed at (the backup),
 * per Design Review note 2 — not the tier's normal unswitched model.
 */
export function secondFailureSentence(model: string): string {
  return (
    `**No automatic retry this time.** This step was already re-run once on a backup model and has now failed ` +
    `again because **${model}** was unavailable. It has been left failed. Check your model credits or plan, ` +
    `then reset or re-run the step.`
  );
}
