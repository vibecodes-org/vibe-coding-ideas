"use client";

import { useEffect, useRef } from "react";
import { migrateLaunchPathPin } from "@/actions/launch-path";
import {
  clearLaunchPathPin,
  isPlausibleProjectPath,
  readLaunchPath,
} from "@/lib/launch-claude-code";
import { getMachineIdentity } from "@/lib/terminal/machine-identity";
import { logger } from "@/lib/logger";

/**
 * One-time fold-in of a pre-existing "Set exact folder" localStorage pin into
 * `idea_project_paths` (server) — see `migrateLaunchPathPin` /
 * `decidePinMigration` for the full decision. Mounted once per idea (in
 * `BoardLaunchProvider`, not per launch-button instance — a board can render
 * several launch buttons for the same idea, and this must not fire once per
 * button).
 *
 * Runs only when an EXISTING-mode pin is still in localStorage; the pin is
 * cleared ONLY when something was actually written for it — `result.ok &&
 * result.action !== "skip"` — so it a) stops being read anywhere (retired
 * per the fix) once folded into the server record, and b) this effect
 * naturally becomes a no-op on the next mount for that case — no separate
 * "already migrated" flag needed. A failure (network/RLS/etc.), or a "skip"
 * (decidePinMigration's >1-rows, none-matching case, which deliberately
 * writes nothing server-side — see its doc), leaves the pin in place so the
 * next page load retries — self-healing, matching the project's
 * `record_project_path` self-heal pattern. Critically, "skip" must NOT clear
 * the pin: nothing was saved server-side, so the pin is the only record of
 * this folder that exists anywhere — deleting it here would be pure data
 * loss, not a retry.
 *
 * A pin that fails `isPlausibleProjectPath` — not an expanded absolute path,
 * or a "landing zone" like `/` or a home directory that would poison every
 * future launch — is a separate, TERMINAL case: no retry can ever fix it (the
 * server action rejects it the same way, every time), so it's cleared
 * immediately, client-side, before even calling the server — otherwise it
 * would silently retry-and-warn-log on every single board load, forever.
 *
 * Passes `getMachineIdentity()` — this browser's real machine hostname, if a
 * terminal session has ever announced one — so the migration can land on
 * this machine's own row instead of the `MANUAL_PIN_HOSTNAME` fallback (see
 * `decidePinMigration`'s precedence table in launch-claude-code.ts).
 */
export function useLaunchPathPinMigration(ideaId: string): void {
  const attempted = useRef(false);

  useEffect(() => {
    // Guards a double-invoke within the SAME mount (e.g. React StrictMode) —
    // NOT cross-mount persistence; that's what clearing the pin on success is
    // for. A failed attempt intentionally resets nothing here, either: the
    // next full mount (e.g. navigating back to the board) retries via the
    // localStorage-presence check itself, no extra bookkeeping required.
    if (attempted.current) return;

    const pin = readLaunchPath(ideaId);
    if (!pin || pin.mode !== "existing") return;

    // readLaunchPath doesn't validate what it reads back, so a corrupted or
    // hand-edited pin — including `/` or a home directory — can reach here
    // looking like a normal one. It would fail this same check server-side
    // (migrateLaunchPathPin's own isPlausibleProjectPath guard) on every
    // retry forever — checking here first lets us drop it once, terminally,
    // instead of round-tripping to the server and warn-logging on every
    // board load.
    if (!isPlausibleProjectPath(pin.path)) {
      clearLaunchPathPin(ideaId);
      return;
    }

    attempted.current = true;
    void migrateLaunchPathPin(ideaId, pin.path, getMachineIdentity()).then((result) => {
      // "skip" is `ok: true` but writes nothing server-side (decidePinMigration's
      // >1-rows, none-matching case) — the pin must survive it, or the only
      // record of this folder is destroyed for nothing. Only clear once
      // something was actually saved.
      if (result.ok && result.action !== "skip") {
        clearLaunchPathPin(ideaId);
      } else if (result.action === "skip") {
        logger.debug("launch path pin migration skipped (ambiguous rows), pin kept", { ideaId });
      } else {
        logger.warn("launch path pin migration failed, will retry next load", {
          ideaId,
          action: result.action,
        });
      }
    });
  }, [ideaId]);
}
