// In-app terminal — scrollback hand-off (card 35cffc10,
// docs/design-terminal-scrollback-transfer.html §7 "Reusable module
// boundary"). The two pure functions that turn a live xterm.js terminal's
// on-screen history into a small, transportable string and back again.
//
// Deliberately transport-agnostic: nothing here knows about BroadcastChannel,
// the pop-out hand-off, or any other caller — see popout-channel.ts for the
// ONE current caller (both directions: dock → popped at pop-out, popped →
// dock at bring-back). The reload-reattach card (design §9, out of scope
// here) reuses these two functions verbatim with a different transport
// (sessionStorage) and a different trigger; nothing in this module binds to
// BroadcastChannel-specific concerns.
//
// Both functions are pure with respect to everything but the passed
// terminal, so they unit-test against a stub terminal the same way
// popout-channel.ts tests against a stub channel — no real xterm/DOM
// required. `@xterm/addon-serialize`'s own activation reaches into a real
// Terminal's internals, so the unit tests mock the addon module itself
// (see scrollback-transfer.test.ts's header doc) rather than trying to run
// it against a plain stub.

import { SerializeAddon } from "@xterm/addon-serialize";

/** The only shape that crosses any transport (design §7). */
export interface TransferredBuffer {
  data: string;
  truncated: boolean;
}

/**
 * Everything serializeScrollback/restoreScrollback need from a live
 * xterm.js `Terminal` — a real instance satisfies this trivially (every
 * member is already part of its public API, the same subset
 * use-terminal-session.ts already calls directly); tests pass a plain
 * object instead, no DOM or real xterm required.
 */
export interface ScrollbackCapableTerminal {
  loadAddon(addon: SerializeAddon): void;
  /** Full reset (RIS) — the ONLY xterm operation that actually empties the scrollback buffer; `clear()` only clears the viewport and leaves history behind. */
  reset(): void;
  write(data: string): void;
  readonly buffer: { readonly active: { readonly length: number } };
}

/** D2: 1 MiB (1,048,576 bytes) of serialized data, per transfer, either direction. */
export const SCROLLBACK_TRANSFER_CAP_BYTES = 1_048_576;

/** D2's exact marker copy — the em-dash-framed sentence carries the meaning on its own (never colour alone, WCAG 1.4.1); rendered dim via SGR by restoreScrollback. */
export const SCROLLBACK_TRUNCATION_MARKER_TEXT = "— older history trimmed during hand-off —";

/** Defensive ceiling on halving attempts — a bounded-loop guarantee, not a realistic path: a 5,000-line scrollback (xterm's own cap) resolves under the byte cap in well under this many halvings. */
const MAX_TRUNCATION_ATTEMPTS = 30;

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Serializes a terminal's full on-screen history (viewport + scrollback) via
 * `@xterm/addon-serialize`, capped at `capBytes` (default 1 MiB, D2).
 *
 * Truncation is whole-row and oldest-first: a full serialize over the cap is
 * re-run with a HALVED `scrollback` row count, repeatedly, rather than
 * slicing the serialized STRING at a byte offset — a byte slice can land
 * mid-escape-sequence and corrupt every line rendered after the cut (D2,
 * rejected). The halving starts from the terminal's own current buffer
 * length so it converges in O(log2(lines)) steps; `MAX_TRUNCATION_ATTEMPTS`
 * is a defensive bound only, never expected to bind in practice.
 *
 * Never throws — any internal failure (a hostile/incomplete terminal stub,
 * an addon exception, anything) is caught and reported as an honest empty,
 * non-truncated buffer, exactly like a session with no scrollback to hand
 * over. Scrollback is never allowed to sink a hand-off (design §1's
 * "Decision: buffer rides inside payload" callout).
 */
export function serializeScrollback(
  term: ScrollbackCapableTerminal,
  capBytes: number = SCROLLBACK_TRANSFER_CAP_BYTES,
): TransferredBuffer {
  let addon: SerializeAddon | null = null;
  try {
    addon = new SerializeAddon();
    term.loadAddon(addon);

    let data = addon.serialize();
    if (byteLength(data) <= capBytes) {
      return { data, truncated: false };
    }

    // Over cap — halve the scrollback row count, oldest rows dropped first,
    // until the re-serialized result fits (or we hit the row/attempt floor).
    const totalLines = term.buffer.active.length;
    let rowCount = Number.isFinite(totalLines) ? Math.max(0, Math.floor(totalLines)) : 0;
    let attempts = 0;
    while (byteLength(data) > capBytes && rowCount > 0 && attempts < MAX_TRUNCATION_ATTEMPTS) {
      rowCount = Math.floor(rowCount / 2);
      data = addon.serialize({ scrollback: rowCount });
      attempts += 1;
    }
    return { data, truncated: true };
  } catch {
    return { data: "", truncated: false };
  } finally {
    try {
      addon?.dispose();
    } catch {
      /* best-effort cleanup only — never overrides the result computed above */
    }
  }
}

/**
 * Restores a previously-serialized buffer into `term`: a FULL reset first
 * (`term.reset()`, never `clear()` — see `ScrollbackCapableTerminal.reset`'s
 * doc), then the dim truncation marker line (only when `buffer.truncated`),
 * then the data itself. Safe to call with an empty, non-truncated buffer —
 * a no-op beyond the reset.
 *
 * Never throws, mirroring `serializeScrollback`'s contract: a failure here
 * must never sink a hand-off that otherwise succeeded — the caller (the
 * pop-out/bring-back wiring) always proceeds to attach/reconnect regardless.
 */
export function restoreScrollback(term: ScrollbackCapableTerminal, buffer: TransferredBuffer): void {
  try {
    term.reset();
    if (buffer.truncated) {
      term.write(`\x1b[2m${SCROLLBACK_TRUNCATION_MARKER_TEXT}\x1b[0m\r\n`);
    }
    if (buffer.data) term.write(buffer.data);
  } catch {
    /* never throws — a failed restore just leaves the terminal freshly reset */
  }
}
