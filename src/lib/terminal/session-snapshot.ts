// Session entry chooser + reload-reattach (card cbe60db5) — the "instant
// continue" snapshot layer (design doc's optional variant, § veto note,
// Nick: yes). A live session periodically mirrors its scrollback into THIS
// TAB's own `sessionStorage` under `vc:term:snap:<sid>`; on a same-tab reload
// within `SNAPSHOT_FRESHNESS_MS` (60s), the dock treats that as proof the tab
// held the session moments before and reattaches automatically — no chooser,
// no click (see entry-decision.ts's `decideEntryBehaviour`).
//
// `sessionStorage` is per-tab and survives a reload but not a new tab/window
// — exactly the "this exact tab, moments ago" signal the design calls for.
// Deliberately NOT a re-implementation of scrollback-transfer.ts's
// serialize/restore mechanics (that module stays transport-agnostic, per its
// own doc comment) — this module is only the STORAGE half: turning a
// `TransferredBuffer` into a timestamped, size-capped `sessionStorage` entry
// and back.
//
// Quota-safe (design: "quota-safe: catch → evict own oldest → retry once →
// skip"): a `sessionStorage` write can throw `QuotaExceededError` (Safari in
// particular has a low per-origin cap). On failure this module evicts its OWN
// oldest snapshot (never another feature's keys — only `vc:term:snap:*`),
// retries once, and silently gives up beyond that — a failed snapshot must
// never surface to the user or block the terminal itself.

import type { TransferredBuffer } from "./scrollback-transfer";

/** Every snapshot this module writes lives under this prefix — the ONLY keys eviction is allowed to touch. */
export const SNAPSHOT_KEY_PREFIX = "vc:term:snap:";

/** "Fresh" per the design's instant-continue variant: under 60s old. */
export const SNAPSHOT_FRESHNESS_MS = 60_000;

/** How often a connected session re-snapshots while output keeps arriving (design item 5). */
export const SNAPSHOT_SAVE_INTERVAL_MS = 20_000;

export interface StoredSnapshot {
  data: string;
  truncated: boolean;
  /** Epoch ms the snapshot was written — the freshness check's input. */
  savedAt: number;
}

/** The `sessionStorage` key for one session id's snapshot. */
export function snapshotKey(sid: string): string {
  return `${SNAPSHOT_KEY_PREFIX}${sid}`;
}

/** Pure freshness check — never negative-clock-skew "fresh" (savedAt in the future fails too). */
export function isSnapshotFresh(
  savedAt: number,
  nowMs: number = Date.now(),
  freshnessMs: number = SNAPSHOT_FRESHNESS_MS,
): boolean {
  const age = nowMs - savedAt;
  return age >= 0 && age < freshnessMs;
}

/** Pure serialize — the exact string written to storage, so tests don't need real `sessionStorage`. */
export function serializeSnapshot(buffer: TransferredBuffer, savedAt: number): string {
  return JSON.stringify({ data: buffer.data, truncated: buffer.truncated, savedAt } satisfies StoredSnapshot);
}

/** Pure parse — malformed/foreign JSON (or a missing field) parses to `null`, never throws. */
export function parseSnapshot(raw: string | null | undefined): StoredSnapshot | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as StoredSnapshot).data === "string" &&
      typeof (parsed as StoredSnapshot).truncated === "boolean" &&
      typeof (parsed as StoredSnapshot).savedAt === "number"
    ) {
      return parsed as StoredSnapshot;
    }
    return null;
  } catch {
    return null;
  }
}

/** `window.sessionStorage`, or `null` when unavailable (SSR, privacy mode, disabled storage) — never throws. */
function defaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Evicts THIS module's own oldest snapshot (by `savedAt`, ignoring
 * `excludeKey` — the write that's currently failing) to make room. Returns
 * whether an eviction happened, so the caller knows whether a retry is worth
 * attempting. Never touches a key outside `SNAPSHOT_KEY_PREFIX`.
 */
function evictOldestSnapshot(storage: Storage, excludeKey: string): boolean {
  let oldestKey: string | null = null;
  let oldestSavedAt = Infinity;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || key === excludeKey || !key.startsWith(SNAPSHOT_KEY_PREFIX)) continue;
    const parsed = parseSnapshot(storage.getItem(key));
    const savedAt = parsed?.savedAt ?? -Infinity; // an unparseable entry is evicted first
    if (savedAt < oldestSavedAt) {
      oldestSavedAt = savedAt;
      oldestKey = key;
    }
  }
  if (!oldestKey) return false;
  try {
    storage.removeItem(oldestKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Save a session's scrollback snapshot to THIS tab's `sessionStorage`.
 * Quota-safe per the module doc: on a write failure, evict our own oldest
 * snapshot and retry once; a second failure is a silent no-op (never blocks
 * or surfaces to the user — a missing snapshot just means the next reload
 * shows the chooser/amber note instead of instant-continue, never a crash).
 */
export function saveSessionSnapshot(
  sid: string,
  buffer: TransferredBuffer,
  nowMs: number = Date.now(),
  storage: Storage | null = defaultStorage(),
): void {
  if (!storage) return;
  const key = snapshotKey(sid);
  const raw = serializeSnapshot(buffer, nowMs);
  try {
    storage.setItem(key, raw);
    return;
  } catch {
    /* quota (or another storage error) — fall through to eviction below */
  }
  if (evictOldestSnapshot(storage, key)) {
    try {
      storage.setItem(key, raw);
    } catch {
      /* still over quota after evicting one — skip, never throw */
    }
  }
}

/** Load a session's snapshot, or `null` when absent/unparseable/storage unavailable. Never throws. */
export function loadSessionSnapshot(
  sid: string,
  storage: Storage | null = defaultStorage(),
): StoredSnapshot | null {
  if (!storage) return null;
  try {
    return parseSnapshot(storage.getItem(snapshotKey(sid)));
  } catch {
    return null;
  }
}

/** Clear a session's snapshot — called on a clean end so a later reload never restores a dead session's output. */
export function clearSessionSnapshot(sid: string, storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(snapshotKey(sid));
  } catch {
    /* best-effort only */
  }
}

// ── the "reconnected" divider (design: instant-continue + chooser Reconnect) ─
//
// Common foundations F2: "on reattach a snapshot restores with the divider
// `— reconnected · earlier output restored —`". `restoreScrollback`
// (scrollback-transfer.ts) already prepends its OWN dim marker line when
// `buffer.truncated` — that marker means something different (older history
// TRIMMED during a hand-off) and stays untouched; this is a distinct divider
// for a distinct moment (a whole PRIOR snapshot restored after a reload), so
// it's composed into the `data` here rather than added as a second field
// scrollback-transfer.ts would have to know about.

/** The design's exact divider text. */
export const RECONNECT_DIVIDER_TEXT = "— reconnected · earlier output restored —";

/**
 * Turn a stored snapshot into a `TransferredBuffer` ready for
 * `restoreScrollback`, with the reconnect divider prefixed (dim SGR + CRLF,
 * matching scrollback-transfer.ts's own truncation-marker styling). If the
 * snapshot was itself truncated, `restoreScrollback` still adds ITS marker
 * first (older-history-trimmed), then this divider, then the data — both
 * are honest about what happened and neither hides the other.
 */
export function toReconnectBuffer(snapshot: StoredSnapshot): TransferredBuffer {
  return {
    data: `\x1b[2m${RECONNECT_DIVIDER_TEXT}\x1b[0m\r\n${snapshot.data}`,
    truncated: snapshot.truncated,
  };
}

// ── "was open in this tab" (design: instant-continue's fallback badge) ─────
//
// A SEPARATE, un-timestamped memory of the last session id this tab ever
// attached — kept even once the snapshot itself goes stale, so a reload well
// past the 60s instant-continue window can still badge that row "was open in
// this tab" and pre-focus it (Enter reconnects) instead of leaving the
// chooser with no hint which session was this tab's own.

const LAST_TAB_SID_KEY = "vc:term:last-sid";

/** Remember this tab's most recently attached session id (best-effort, never throws). */
export function rememberLastTabSid(sid: string, storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(LAST_TAB_SID_KEY, sid);
  } catch {
    /* best-effort only */
  }
}

/** This tab's last-known session id, or `null` if never set/unavailable. */
export function readLastTabSid(storage: Storage | null = defaultStorage()): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(LAST_TAB_SID_KEY);
  } catch {
    return null;
  }
}
