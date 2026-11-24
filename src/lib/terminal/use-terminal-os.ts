"use client";

// In-app terminal — which system this browser is on, for wording (card 51d424f7).
//
// Screens that don't already hold the session's TerminalPlatform read it here.
// The server render (no navigator) uses the Mac wording, then the client swaps
// to its real system after hydration, with no hydration mismatch
// (useSyncExternalStore's server snapshot). Known limit (working notes): a
// phone watching a session that runs on a PC still says "Mac", because the
// wording follows the browser's machine, not the helper's.

import { useSyncExternalStore } from "react";
import { readPlatformSignals, resolveTerminalPlatform, type TerminalOs } from "./platform";

const noSubscribe = () => () => {};
const readOs = (): TerminalOs => resolveTerminalPlatform(readPlatformSignals()).os;
const serverOs = (): TerminalOs => "mac";

export function useTerminalOs(): TerminalOs {
  return useSyncExternalStore(noSubscribe, readOs, serverOs);
}
