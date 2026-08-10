// Session entry chooser + reload-reattach (card cbe60db5, design item 8) —
// the POPPED WINDOW's own memory of which session it holds, stashed in ITS
// OWN sessionStorage at successful hand-off. A popped window that gets
// reloaded (accidental Cmd+R, a crash-recovery restore) starts a FRESH
// handshake with a nonce that no longer means anything to a dock that's
// still listening for the OLD one — see terminal-popout-client.tsx's doc for
// the two outcomes: if the originating dock tab is still open and still
// listening on that (stable, window.name-persisted) channel name, the
// existing retried-handshake protocol just re-delivers the payload as
// normal; if it's gone (closed, navigated away), the handshake times out
// with a "stale nonce" and THIS stash is what lets the popped window recover
// on its own via the reattach route, instead of the generic "lost the
// hand-off, close and re-pop" dead end.
//
// Deliberately its own tiny module (mirrors session-snapshot.ts's shape) so
// the storage plumbing is unit-tested without a real popped window.

/** One flat key — a popped window holds exactly one session for its lifetime. */
const STASH_KEY = "vc:pop:sid";

export interface PopoutStash {
  sid: string;
  label: string;
  identity: string;
  readOnly: boolean;
  ideaId: string;
  /** Not in the design's literal field list but required by TerminalPopoutView's
   *  descriptor/document-title — carried alongside the rest rather than re-fetched. */
  ideaTitle: string;
}

function defaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Pure parse — malformed/foreign JSON (or a missing field) parses to `null`, never throws. */
export function parsePopoutStash(raw: string | null | undefined): PopoutStash | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as PopoutStash).sid === "string" &&
      typeof (parsed as PopoutStash).label === "string" &&
      typeof (parsed as PopoutStash).identity === "string" &&
      typeof (parsed as PopoutStash).readOnly === "boolean" &&
      typeof (parsed as PopoutStash).ideaId === "string" &&
      typeof (parsed as PopoutStash).ideaTitle === "string"
    ) {
      return parsed as PopoutStash;
    }
    return null;
  } catch {
    return null;
  }
}

/** Save this window's hand-off stash — best-effort, never throws. */
export function savePopoutStash(stash: PopoutStash, storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(STASH_KEY, JSON.stringify(stash));
  } catch {
    /* best-effort only — a failed stash just means a stale-nonce reload falls
     * back to the generic "lost the hand-off" state instead of recovering */
  }
}

/** Load this window's stash, or `null` when absent/unparseable/unavailable. Never throws. */
export function loadPopoutStash(storage: Storage | null = defaultStorage()): PopoutStash | null {
  if (!storage) return null;
  try {
    return parsePopoutStash(storage.getItem(STASH_KEY));
  } catch {
    return null;
  }
}

/** Clear the stash — best-effort, never throws. */
export function clearPopoutStash(storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(STASH_KEY);
  } catch {
    /* best-effort only */
  }
}
