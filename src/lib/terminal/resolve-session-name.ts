// Terminal session naming — THE one naming rule (card 3bf262ac, Requirements
// §3, docs/design-terminal-session-naming.html §1). Every surface that shows
// a session's name — the dock tab, the session chooser's live and recent
// rows, the My Sessions panel, the pop-out window title, and aria
// announcements — must resolve its label through this pure function, so the
// same session reads identically everywhere. Before this card the tab/panel
// (`deriveTabLabel` in terminal-tabs.ts) and the chooser
// (`row.taskTitle?.trim() || row.ideaTitle || row.sid.slice(0, 8)`) derived
// two DIFFERENT shapes for the same row — that drift is exactly what this
// module closes. `deriveTabLabel` now delegates here.
//
// Precedence (Requirements §3, unchanged by design):
//   1. the user's own name (`terminal_sessions.display_name`), trimmed, if non-empty
//   2. the task title the session was launched from, trimmed, if non-empty
//   3. fallback: "<idea title> · <first 4 chars of sid>" — or "Session · <sid4>"
//      when the idea title itself is blank (design §1, the fallback-shape decision:
//      the FULL idea title, never the URL-safe slug — see that section for why).

const SID_SHORT_LEN = 4;

/** The fallback's disambiguating suffix — 4 characters everywhere (the chooser's old 8-char variant is retired, design §1). */
export function shortSessionId(sessionId: string | null | undefined): string {
  return sessionId ? sessionId.slice(0, SID_SHORT_LEN) : "…";
}

export interface ResolveSessionNameInput {
  /** The user's own name for this session (`terminal_sessions.display_name`) — highest precedence when non-blank. */
  displayName?: string | null;
  /** Captured at launch from the task card the session started on, if any. */
  taskTitle?: string | null;
  /** The idea/board's title — used only to build the fallback shape. */
  ideaTitle?: string | null;
  /** The session id, once known — its first 4 characters are the fallback's disambiguator. */
  sessionId?: string | null;
  /**
   * Cross-board switch UX (task b70bcbeb, terminal-tabs.ts's
   * `resolveTabBoardIdentity`): false only for a session whose own board is
   * genuinely unrecorded (a legacy row that predates `SessionEntry.ideaId`)
   * — the fallback tier then reads "Board not recorded · <sid4>" rather than
   * building `<ideaTitle> · <sid4>` from a title that was never actually
   * confirmed as this session's own. Defaults to true — every ordinary
   * caller already has (or can trivially resolve) a concrete board.
   */
  boardKnown?: boolean;
}

export function resolveSessionName(input: ResolveSessionNameInput): string {
  const userName = input.displayName?.trim();
  if (userName) return userName;

  const taskTitle = input.taskTitle?.trim();
  if (taskTitle) return taskTitle;

  const sid = shortSessionId(input.sessionId);
  if (input.boardKnown === false) return `Board not recorded · ${sid}`;

  const ideaTitle = input.ideaTitle?.trim();
  return ideaTitle ? `${ideaTitle} · ${sid}` : `Session · ${sid}`;
}

/**
 * True when `resolveSessionName` would land on the fallback tier (precedence
 * step 3) — i.e. there's no user name and no task title, so the resolved
 * label is already "<idea title> · <sid4>" (or "Session · <sid4>").
 *
 * Row surfaces (chooser, My Sessions) show the idea title again as a
 * secondary chip next to the name — but the fallback label already contains
 * it, so without this check a toolbar-launched, never-renamed session reads
 * "Vibe Coding Ideas · a3f9  Vibe Coding Ideas" (design §1, "De-duplication
 * rule for rows"). Callers use this to suppress that chip.
 *
 * Deliberately checks the *inputs* that decide precedence, not a string
 * comparison against the resolved label — a user could in principle type a
 * name that happens to match the fallback text, and suppressing the chip in
 * that case is still correct (the chip would duplicate what's on screen
 * either way).
 */
export function isFallbackSessionName(input: Pick<ResolveSessionNameInput, "displayName" | "taskTitle">): boolean {
  return !input.displayName?.trim() && !input.taskTitle?.trim();
}
