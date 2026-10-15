// The one-go move of every old-layout agent into the new instructions layout
// (task 472d5672, Nick's change 1). Pure logic over a small store interface,
// so it is tested here with in-memory fixtures; scripts/convert-agent-layouts.ts
// runs it against production from the "Agent layout conversion" GitHub Actions
// workflow.
//
// THE REPO IS PUBLIC. Nothing in this module prints, returns or logs prompt
// text, and neither do its callers: reports carry ids, owner group, layout,
// lengths and counts only. (The one exception, the CLI's `--show`, is limited to
// platform-owned agents, whose prompts are already public in migrations.)
//
// Safety:
//  - Every changed row is backed up first under BACKUP_REASON (migration 00186
//    snapshots all rows; apply adds a fresh backup for any row whose text has
//    changed since).
//  - Each update is compare-and-set on updated_at: an agent edited mid-run is
//    skipped, never overwritten.
//  - Each row must pass the three checks in verifyConversion or it is reported
//    as failed and left untouched.
//  - Re-runnable: converted text parses as the new layout, so a second apply
//    converts nothing.

import {
  convertLegacyText,
  generateInstructions,
  layoutOf,
  parseInstructions,
  verifyConversion,
  type InstructionsLayout,
} from "./agent-instructions";

export const BACKUP_REASON = "pre-layout-conversion-00186";
/** The platform account whose agents' prompts are already public (see 00148 and friends). */
export const PLATFORM_OWNER_ID = "a0000000-0000-4000-a000-000000000001";

export type OwnerGroup = "platform" | "owner" | "other";
export type ConversionMode = "dry-run" | "apply" | "verify" | "restore";

export interface AgentRow {
  id: string;
  owner_id: string;
  role: string | null;
  system_prompt: string | null;
  updated_at: string;
}

export interface BackupRow {
  bot_id: string;
  system_prompt: string | null;
  backed_up_at: string;
}

export interface NewBackup {
  bot_id: string;
  name: string | null;
  role: string | null;
  system_prompt: string | null;
  reason: string;
}

export interface ConversionStore {
  listAgents(): Promise<(AgentRow & { name: string | null })[]>;
  listBackups(reason: string): Promise<BackupRow[]>;
  insertBackup(backup: NewBackup): Promise<void>;
  /** Compare-and-set on updated_at. True when the row was updated. */
  setPrompt(id: string, systemPrompt: string | null, expectedUpdatedAt: string): Promise<boolean>;
}

export interface ConversionOptions {
  /** The signed-in owner's user id, to report their agents as their own group. Optional. */
  ownerId?: string | null;
}

export function ownerGroupOf(ownerId: string, opts: ConversionOptions = {}): OwnerGroup {
  if (ownerId === PLATFORM_OWNER_ID) return "platform";
  if (opts.ownerId && ownerId === opts.ownerId) return "owner";
  return "other";
}

// ── Reports: ids, groups, layouts, lengths and counts only ────────────────

export type RowStatus =
  | "convert"
  | "converted"
  | "already-new"
  | "left-alone"
  | "empty"
  | "failed"
  | "skipped-edited"
  | "restored"
  | "restore-skipped";

export interface RowReport {
  id: string;
  group: OwnerGroup;
  layout: InstructionsLayout;
  oldLength: number;
  newLength?: number;
  status: RowStatus;
  reason?: string;
}

export interface ConversionReport {
  mode: ConversionMode;
  total: number;
  /** Count of rows by status. */
  counts: Partial<Record<RowStatus, number>>;
  /** Count of rows by owner group and layout. */
  byGroupAndLayout: Record<string, number>;
  maxOldLength: number;
  totalOldLength: number;
  rows: RowReport[];
}

function newReport(mode: ConversionMode): ConversionReport {
  return { mode, total: 0, counts: {}, byGroupAndLayout: {}, maxOldLength: 0, totalOldLength: 0, rows: [] };
}

function record(report: ConversionReport, row: RowReport): void {
  report.rows.push(row);
  report.total += 1;
  report.counts[row.status] = (report.counts[row.status] ?? 0) + 1;
  const key = `${row.group}/${row.layout}`;
  report.byGroupAndLayout[key] = (report.byGroupAndLayout[key] ?? 0) + 1;
  report.totalOldLength += row.oldLength;
  report.maxOldLength = Math.max(report.maxOldLength, row.oldLength);
}

// ── Planning one row ──────────────────────────────────────────────────────

export interface PlannedRow {
  report: RowReport;
  /** The converted text, only for rows that passed all three checks. In memory only. */
  newText: string | null;
}

export function planRow(row: AgentRow, opts: ConversionOptions = {}): PlannedRow {
  const text = row.system_prompt ?? "";
  const layout = layoutOf(text, row.role);
  const base = { id: row.id, group: ownerGroupOf(row.owner_id, opts), layout, oldLength: text.length };

  if (layout === "empty") return { report: { ...base, status: "empty" }, newText: null };
  if (layout === "new") return { report: { ...base, status: "already-new" }, newText: null };
  if (layout === "neither") return { report: { ...base, status: "left-alone" }, newText: null };

  const converted = convertLegacyText(text, row.role);
  if (!converted) {
    return { report: { ...base, status: "failed", reason: "could not convert" }, newText: null };
  }
  const verdict = verifyConversion(text, converted, row.role);
  if (!verdict.ok) {
    return { report: { ...base, status: "failed", reason: verdict.reason }, newText: null };
  }
  return {
    report: { ...base, status: "convert", newLength: converted.text.length },
    newText: converted.text,
  };
}

// ── Modes ─────────────────────────────────────────────────────────────────

export async function dryRun(store: ConversionStore, opts: ConversionOptions = {}): Promise<ConversionReport> {
  const report = newReport("dry-run");
  for (const row of await store.listAgents()) record(report, planRow(row, opts).report);
  return report;
}

export async function apply(store: ConversionStore, opts: ConversionOptions = {}): Promise<ConversionReport> {
  const report = newReport("apply");
  const backups = await store.listBackups(BACKUP_REASON);
  // Without the 00186 snapshot there is no safety net: refuse rather than convert.
  if (backups.length === 0) {
    throw new Error(`No backups found under reason ${BACKUP_REASON}: apply migration 00186 first.`);
  }
  const latestBackup = latestPerAgent(backups);

  for (const row of await store.listAgents()) {
    const planned = planRow(row, opts);
    if (planned.report.status !== "convert" || planned.newText === null) {
      record(report, planned.report);
      continue;
    }

    // The snapshot covers the text as of migration 00186. If this row has
    // changed since (or is new), back up its current text before touching it.
    const snapshot = latestBackup.get(row.id);
    if (!snapshot || snapshot.system_prompt !== row.system_prompt) {
      await store.insertBackup({
        bot_id: row.id,
        name: row.name,
        role: row.role,
        system_prompt: row.system_prompt,
        reason: BACKUP_REASON,
      });
    }

    const updated = await store.setPrompt(row.id, planned.newText, row.updated_at);
    record(
      report,
      updated
        ? { ...planned.report, status: "converted" }
        : { ...planned.report, status: "skipped-edited", reason: "changed while the job was running" },
    );
  }
  return report;
}

/**
 * Check every agent that has been converted: it still reads as the new layout,
 * generating from what it parses to gives the same text back, and (against its
 * backup) no words were lost. Agents edited since the conversion are counted as
 * "skipped-edited" and not judged. Also reports how many old-layout agents remain.
 */
export async function verify(store: ConversionStore, opts: ConversionOptions = {}): Promise<ConversionReport> {
  const report = newReport("verify");
  const latestBackup = latestPerAgent(await store.listBackups(BACKUP_REASON));

  for (const row of await store.listAgents()) {
    const text = row.system_prompt ?? "";
    const layout = layoutOf(text, row.role);
    const base = { id: row.id, group: ownerGroupOf(row.owner_id, opts), layout, oldLength: text.length };
    const backup = latestBackup.get(row.id);

    // Not converted by us (no backup text, or the text is unchanged since).
    if (!backup || backup.system_prompt === row.system_prompt || backup.system_prompt === null) {
      const status: RowStatus = layout === "legacy" ? "failed" : layout === "new" ? "already-new" : layout === "empty" ? "empty" : "left-alone";
      record(report, {
        ...base,
        status,
        ...(status === "failed" ? { reason: "still in the old layout" } : {}),
      });
      continue;
    }

    const expected = convertLegacyText(backup.system_prompt, row.role);
    if (!expected) {
      // The backup was not old-layout, yet the text changed: someone edited it.
      record(report, { ...base, status: "skipped-edited", reason: "edited since the backup" });
      continue;
    }
    if (text !== expected.text) {
      record(report, { ...base, status: "skipped-edited", reason: "edited since the conversion" });
      continue;
    }

    const parsed = parseInstructions(text, row.role);
    const roundTrips = parsed?.source === "new" && generateInstructions(parsed.fields) === text;
    const verdict = verifyConversion(backup.system_prompt, expected, row.role);
    if (!roundTrips) record(report, { ...base, status: "failed", reason: "does not read back into the same boxes" });
    else if (!verdict.ok) record(report, { ...base, status: "failed", reason: verdict.reason });
    else record(report, { ...base, status: "converted", newLength: text.length });
  }
  return report;
}

/** Put back only agents still exactly as the conversion left them. */
export async function restore(store: ConversionStore, opts: ConversionOptions = {}): Promise<ConversionReport> {
  const report = newReport("restore");
  const latestBackup = latestPerAgent(await store.listBackups(BACKUP_REASON));

  for (const row of await store.listAgents()) {
    const text = row.system_prompt ?? "";
    const base = { id: row.id, group: ownerGroupOf(row.owner_id, opts), layout: layoutOf(text, row.role), oldLength: text.length };
    const backup = latestBackup.get(row.id);

    if (!backup || backup.system_prompt === row.system_prompt) {
      record(report, { ...base, status: "restore-skipped", reason: "nothing to restore" });
      continue;
    }
    const expected = backup.system_prompt === null ? null : convertLegacyText(backup.system_prompt, row.role);
    if (!expected || expected.text !== text) {
      record(report, { ...base, status: "restore-skipped", reason: "edited since the conversion" });
      continue;
    }
    const ok = await store.setPrompt(row.id, backup.system_prompt, row.updated_at);
    record(
      report,
      ok
        ? { ...base, status: "restored", newLength: backup.system_prompt?.length ?? 0 }
        : { ...base, status: "restore-skipped", reason: "changed while the job was running" },
    );
  }
  return report;
}

export async function runMode(
  mode: ConversionMode,
  store: ConversionStore,
  opts: ConversionOptions = {},
): Promise<ConversionReport> {
  switch (mode) {
    case "dry-run":
      return dryRun(store, opts);
    case "apply":
      return apply(store, opts);
    case "verify":
      return verify(store, opts);
    case "restore":
      return restore(store, opts);
  }
}

/** The newest backup per agent (backed_up_at, ISO strings compare correctly). */
function latestPerAgent(backups: BackupRow[]): Map<string, BackupRow> {
  const latest = new Map<string, BackupRow>();
  for (const b of backups) {
    const prev = latest.get(b.bot_id);
    if (!prev || b.backed_up_at > prev.backed_up_at) latest.set(b.bot_id, b);
  }
  return latest;
}

// ── Printing: ids, lengths and counts only ────────────────────────────────

/** Text lines for the CLI and the job summary. Never includes prompt text or names. */
export function formatReport(report: ConversionReport): string[] {
  const lines: string[] = [];
  lines.push(`mode: ${report.mode}`);
  lines.push(`agents read: ${report.total} (total ${report.totalOldLength} characters, longest ${report.maxOldLength})`);
  for (const [key, n] of Object.entries(report.byGroupAndLayout).sort()) lines.push(`  ${key}: ${n}`);
  for (const [status, n] of Object.entries(report.counts).sort()) lines.push(`${status}: ${n}`);
  for (const row of report.rows) {
    const worthListing =
      row.status === "failed" ||
      row.status === "skipped-edited" ||
      (row.status === "restore-skipped" && row.reason !== "nothing to restore");
    if (worthListing) {
      lines.push(`  ${row.status} ${row.id} [${row.group}, ${row.layout}, ${row.oldLength} chars]: ${row.reason ?? ""}`);
    }
  }
  return lines;
}

// ── Command line ──────────────────────────────────────────────────────────

export interface CliArgs {
  mode: ConversionMode;
  confirm: string | null;
  show: string | null;
  ownerId: string | null;
}

const MODES: ConversionMode[] = ["dry-run", "apply", "verify", "restore"];
const CONFIRM_WORD: Partial<Record<ConversionMode, string>> = { apply: "CONVERT", restore: "RESTORE" };

/** Parse `--mode x --confirm Y [--show id] [--owner-id id]`; throws a plain message on bad input. */
export function parseCliArgs(argv: string[]): CliArgs {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!flag?.startsWith("--")) throw new Error(`Unexpected argument: ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    values.set(flag.slice(2), value);
  }
  for (const key of values.keys()) {
    if (!["mode", "confirm", "show", "owner-id"].includes(key)) throw new Error(`Unknown option: --${key}`);
  }

  const mode = (values.get("mode") ?? "dry-run") as ConversionMode;
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(", ")}`);
  const confirm = values.get("confirm")?.trim() || null;
  const needed = CONFIRM_WORD[mode];
  if (needed && !values.has("show") && confirm !== needed) {
    throw new Error(`${mode} needs --confirm ${needed}`);
  }
  return { mode, confirm, show: values.get("show")?.trim() || null, ownerId: values.get("owner-id")?.trim() || null };
}

/**
 * `--show <id>`: before and after text, but ONLY for platform-owned agents,
 * whose prompts are already public in the migrations. Anything else is refused.
 */
export async function showPlatformAgent(
  store: ConversionStore,
  id: string,
): Promise<{ before: string; after: string | null }> {
  const row = (await store.listAgents()).find((r) => r.id === id);
  if (!row) throw new Error(`No agent with id ${id}`);
  if (row.owner_id !== PLATFORM_OWNER_ID) {
    throw new Error("--show only works for platform-owned agents: other prompts must not be printed");
  }
  const before = row.system_prompt ?? "";
  return { before, after: convertLegacyText(before, row.role)?.text ?? null };
}
