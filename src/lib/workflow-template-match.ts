import { sameRole } from "@/lib/role-matching";
import type { WorkflowTemplateStep } from "@/types/database";

/**
 * Works out how a template edit should reshape one running card (card bff94aed).
 * Pure: no database access. The result is applied by the reshape_workflow_run
 * database function, which re-checks the card under lock.
 *
 * Rules:
 * - Locked steps (any status but pending) are never changed, moved or deleted.
 * - Frontier F = highest step_order among locked steps (0 if none). The tail is
 *   the pending steps after F. Pending steps before F only get content updates.
 * - Steps are matched to template steps by normalised title, then renames are
 *   paired by position within the gaps between title matches.
 * - Template steps that are new and sit after the last template step matched to
 *   a locked step are added to the tail; earlier ones are not (decision A).
 * - Tail steps with no template counterpart are deleted when untouched, else
 *   kept (and reported) right after the step that preceded them (decision B).
 */

export interface RunStepForMatch {
  id: string;
  status: string;
  step_order: number;
  position?: number | null;
  title: string;
  description: string | null;
  agent_role: string | null;
  human_check_required: boolean;
  expected_deliverables: string[] | null;
  model_tier: string | null;
  effort_override: string | null;
  /** No comment, output, claim, token or start time: safe to delete. */
  untouched: boolean;
}

export interface StepUpdate {
  id: string;
  title: string;
  description: string | null;
  agent_role: string;
  human_check_required: boolean;
  expected_deliverables: string[];
  model_tier: string | null;
  effort_override: string | null;
  step_order: number;
  position: number;
  /** Role changed: drop the agent matched to the old role. */
  clear_agent: boolean;
}

export interface StepInsert {
  title: string;
  description: string | null;
  agent_role: string;
  human_check_required: boolean;
  expected_deliverables: string[];
  model_tier: string | null;
  effort_override: string | null;
  step_order: number;
  position: number;
}

export interface ReshapePlan {
  updates: StepUpdate[];
  inserts: StepInsert[];
  deletes: string[];
  /** Removed from the template but kept because someone has worked on them. */
  keptRemoved: { id: string; title: string }[];
  /** Nothing to write. */
  unchanged: boolean;
  /** What the plan was made from; the database re-checks it before writing. */
  snapshot: { id: string; status: string }[];
}

export function normaliseTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Position convention used when steps are created: (step_order - 1) * 1000. */
export function positionForOrder(stepOrder: number): number {
  return (stepOrder - 1) * 1000;
}

/** Keep the longest run of pairs whose template index increases with run index. */
function longestIncreasing(pairs: Array<[number, number]>, weight: (pair: [number, number]) => number): Array<[number, number]> {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const n = sorted.length;
  const len = sorted.map((p) => weight(p));
  const prev = new Array<number>(n).fill(-1);
  let best = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (sorted[j][1] < sorted[i][1] && len[j] + weight(sorted[i]) > len[i]) {
        len[i] = len[j] + weight(sorted[i]);
        prev[i] = j;
      }
    }
    if (n > 0 && len[i] > len[best]) best = i;
  }
  const out: Array<[number, number]> = [];
  for (let i = n > 0 ? best : -1; i >= 0; i = prev[i]) out.unshift(sorted[i]);
  return out;
}

/** Pair run steps with template steps. Returns runIndex -> templateIndex. */
export function matchRunStepsToTemplate(
  runSteps: Array<Pick<RunStepForMatch, "title" | "agent_role"> & { status?: string }>,
  templateSteps: WorkflowTemplateStep[]
): Map<number, number> {
  // 1. Title anchors: k-th duplicate pairs with k-th duplicate.
  const byTitle = new Map<string, number[]>();
  templateSteps.forEach((t, j) => {
    const key = normaliseTitle(t.title);
    byTitle.set(key, [...(byTitle.get(key) ?? []), j]);
  });
  const seen = new Map<string, number>();
  const rawPairs: Array<[number, number]> = [];
  runSteps.forEach((r, i) => {
    const key = normaliseTitle(r.title);
    const k = seen.get(key) ?? 0;
    seen.set(key, k + 1);
    const j = byTitle.get(key)?.[k];
    if (j !== undefined) rawPairs.push([i, j]);
  });
  // Pairs on locked steps count most, so they are always kept as anchors.
  const anchors = longestIncreasing(rawPairs, ([i]) => (runSteps[i].status && runSteps[i].status !== "pending" ? 1000 : 1));
  const matched = new Map<number, number>(anchors);
  // A title match beats position: a crossing pair is still the same step.
  const usedTpl = new Set(anchors.map(([, j]) => j));
  for (const [i, j] of rawPairs) {
    if (!matched.has(i) && !usedTpl.has(j)) {
      matched.set(i, j);
      usedTpl.add(j);
    }
  }

  // 2. Gaps between anchors: pair renames.
  const bounds: Array<[number, number]> = [[-1, -1], ...anchors, [runSteps.length, templateSteps.length]];
  for (let g = 0; g + 1 < bounds.length; g++) {
    const [r0, t0] = bounds[g];
    const [r1, t1] = bounds[g + 1];
    const rs: number[] = [];
    const ts: number[] = [];
    for (let i = r0 + 1; i < r1; i++) if (!matched.has(i)) rs.push(i);
    for (let j = t0 + 1; j < t1; j++) if (!usedTpl.has(j)) ts.push(j);
    if (rs.length === 0 || ts.length === 0) continue;
    if (rs.length === ts.length && rs.every((i, k) => sameRole(runSteps[i].agent_role ?? "", templateSteps[ts[k]].role))) {
      rs.forEach((i, k) => {
        matched.set(i, ts[k]);
        usedTpl.add(ts[k]);
      });
      continue;
    }
    let lastT = -1;
    for (const i of rs) {
      const role = runSteps[i].agent_role ?? "";
      const sameRoleRuns = rs.filter((x) => sameRole(runSteps[x].agent_role ?? "", role));
      const sameRoleTpl = ts.filter((y) => sameRole(templateSteps[y].role, role));
      if (sameRoleRuns.length === 1 && sameRoleTpl.length === 1 && sameRoleTpl[0] > lastT) {
        matched.set(i, sameRoleTpl[0]);
        usedTpl.add(sameRoleTpl[0]);
        lastT = sameRoleTpl[0];
      }
    }
  }
  return matched;
}

function sameList(a: string[] | null, b: string[]): boolean {
  const x = a ?? [];
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

function toFields(t: WorkflowTemplateStep) {
  return {
    title: t.title,
    description: t.description ?? null,
    agent_role: t.role,
    human_check_required: t.requires_approval ?? false,
    expected_deliverables: t.deliverables ?? [],
    model_tier: t.model_tier ?? null,
    effort_override: t.effort ?? null,
  };
}

export function planReshape(
  runStepsInput: RunStepForMatch[],
  templateSteps: WorkflowTemplateStep[]
): ReshapePlan {
  const runSteps = [...runStepsInput].sort((a, b) => a.step_order - b.step_order);
  const matched = matchRunStepsToTemplate(runSteps, templateSteps);

  const frontier = runSteps.reduce((max, s) => (s.status !== "pending" ? Math.max(max, s.step_order) : max), 0);
  const isTail = (s: RunStepForMatch) => s.status === "pending" && s.step_order > frontier;

  // K = highest template index matched to a locked step.
  let k = -1;
  runSteps.forEach((s, i) => {
    const j = matched.get(i);
    if (s.status !== "pending" && j !== undefined) k = Math.max(k, j);
  });

  const tplToRun = new Map<number, number>();
  matched.forEach((j, i) => tplToRun.set(j, i));

  // New tail in template order.
  type TailItem = { kind: "step"; runIdx: number; tplIdx: number } | { kind: "new"; tplIdx: number } | { kind: "kept"; runIdx: number };
  let tail: TailItem[] = [];
  templateSteps.forEach((_, j) => {
    const i = tplToRun.get(j);
    if (i !== undefined) {
      if (isTail(runSteps[i])) tail.push({ kind: "step", runIdx: i, tplIdx: j });
    } else if (j > k) {
      tail.push({ kind: "new", tplIdx: j });
    }
  });

  // Tail steps with no template counterpart: delete if untouched, else keep.
  const deletes: string[] = [];
  const keptRemoved: { id: string; title: string }[] = [];
  runSteps.forEach((s, i) => {
    if (!isTail(s) || matched.has(i)) return;
    if (s.untouched) {
      deletes.push(s.id);
      return;
    }
    keptRemoved.push({ id: s.id, title: s.title });
    // Right after the nearest earlier run step already in the tail.
    let at = 0;
    for (let p = i - 1; p >= 0; p--) {
      const idx = tail.findIndex((t) => (t.kind === "step" || t.kind === "kept") && t.runIdx === p);
      if (idx >= 0) {
        at = idx + 1;
        break;
      }
    }
    tail = [...tail.slice(0, at), { kind: "kept", runIdx: i }, ...tail.slice(at)];
  });

  const updates: StepUpdate[] = [];
  const inserts: StepInsert[] = [];

  tail.forEach((item, n) => {
    const stepOrder = frontier + 1 + n;
    const position = positionForOrder(stepOrder);
    if (item.kind === "new") {
      inserts.push({ ...toFields(templateSteps[item.tplIdx]), step_order: stepOrder, position });
      return;
    }
    const run = runSteps[item.runIdx];
    const orderChanged = run.step_order !== stepOrder || (run.position ?? position) !== position;
    if (item.kind === "kept") {
      if (orderChanged) {
        updates.push({
          id: run.id,
          title: run.title,
          description: run.description,
          agent_role: run.agent_role ?? "",
          human_check_required: run.human_check_required,
          expected_deliverables: run.expected_deliverables ?? [],
          model_tier: run.model_tier,
          effort_override: run.effort_override,
          step_order: stepOrder,
          position,
          clear_agent: false,
        });
      }
      return;
    }
    const f = toFields(templateSteps[item.tplIdx]);
    if (contentDiffers(run, f) || orderChanged) {
      updates.push({ id: run.id, ...f, step_order: stepOrder, position, clear_agent: roleChanged(run, f.agent_role) });
    }
  });

  // Pending steps before the frontier: content only, never moved.
  runSteps.forEach((s, i) => {
    const j = matched.get(i);
    if (s.status !== "pending" || s.step_order > frontier || j === undefined) return;
    const f = toFields(templateSteps[j]);
    if (!contentDiffers(s, f)) return;
    updates.push({
      id: s.id,
      ...f,
      step_order: s.step_order,
      position: s.position ?? positionForOrder(s.step_order),
      clear_agent: roleChanged(s, f.agent_role),
    });
  });

  return {
    updates,
    inserts,
    deletes,
    keptRemoved,
    unchanged: updates.length === 0 && inserts.length === 0 && deletes.length === 0,
    snapshot: runSteps.map((s) => ({ id: s.id, status: s.status })),
  };
}

function roleChanged(run: RunStepForMatch, role: string): boolean {
  return !sameRole(run.agent_role ?? "", role);
}

function contentDiffers(run: RunStepForMatch, f: ReturnType<typeof toFields>): boolean {
  return (
    run.title !== f.title ||
    (run.description ?? null) !== f.description ||
    (run.agent_role ?? "") !== f.agent_role ||
    run.human_check_required !== f.human_check_required ||
    !sameList(run.expected_deliverables, f.expected_deliverables) ||
    (run.model_tier ?? null) !== f.model_tier ||
    (run.effort_override ?? null) !== f.effort_override
  );
}
