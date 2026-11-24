// In-app terminal — Mac vs Windows wording (card 51d424f7, release 1b).
//
// The terminal's screens were written for the Mac ("this Mac", "menu bar",
// "open Terminal"). A Windows visitor must never see them. Rather than fork
// every copy module, each Mac sentence stays exactly as it is (so the Mac is
// byte-identical) and `forMachine(text, os)` turns it into its PC wording on
// Windows. Sentences with no word-for-word PC equivalent (drag to
// Applications, Apple's developer tools, the menu bar) are rewritten whole by
// the phrase table below; then the plain "Mac" → "PC" swaps run.
// machine-words.test.ts walks every copy module through this and fails on any
// Mac word left in the Windows output.

import type { TerminalOs } from "./platform";

export interface MachineWords {
  /** "Mac" | "PC" */
  machine: string;
  /** Who shows the "Open VibeCodes?" prompt: "your Mac" | "your browser". */
  promptAsker: string;
  /** Where the helper's icon sits: "menu bar" | "the icon by the clock". */
  trayPlace: string;
}

export function machineWords(os: TerminalOs | null | undefined): MachineWords {
  return os === "windows"
    ? { machine: "PC", promptAsker: "your browser", trayPlace: "the icon by the clock" }
    : { machine: "Mac", promptAsker: "your Mac", trayPlace: "menu bar" };
}

/** Whole Mac phrases with their Windows rewrite. Order matters: longest first. */
const WINDOWS_PHRASES: ReadonlyArray<readonly [string, string]> = [
  ["open Terminal on this Mac and type", "open PowerShell and type"],
  ["(in Terminal: ", "(in PowerShell: "],
  ["This Mac needs Apple's developer tools first", "This PC needs Git first"],
  [
    "Your Mac is showing Apple's installer now: click Install (it takes a few minutes), then start again.",
    "Install Git for Windows from https://git-scm.com/download/win, then start again.",
  ],
  ["Drag the new VibeCodes app into Applications to finish.", "Open the new installer to finish."],
  [
    "quit VibeCodes from the menu bar or Activity Monitor, then drag again.",
    "quit VibeCodes from its icon by the clock or Task Manager, then open the installer again.",
  ],
  ["starts when you log in to your Mac", "starts when you sign in to your PC"],
  ["It shows an icon in your menu bar", "It shows an icon by the clock"],
  ["your Mac may ask", "your browser may ask"],
  ["If your Mac asks", "If your browser asks"],
  ["when your Mac asked", "when your browser asked"],
];

const WINDOWS_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bthis Mac\b/g, "this PC"],
  [/\bThis Mac\b/g, "This PC"],
  [/\byour Mac\b/g, "your PC"],
  [/\bYour Mac\b/g, "Your PC"],
];

/** The Mac sentence on a Mac (unchanged), its PC wording on Windows. */
export function forMachine(text: string, os: TerminalOs | null | undefined): string {
  if (os !== "windows") return text;
  let out = text;
  for (const [mac, win] of WINDOWS_PHRASES) out = out.split(mac).join(win);
  for (const [re, win] of WINDOWS_WORDS) out = out.replace(re, win);
  return out;
}

/** forMachine over every string in a copy object (same shape back). */
export function forMachineDeep<T>(copy: T, os: TerminalOs | null | undefined): T {
  if (os !== "windows") return copy;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return forMachine(v, os);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(copy) as T;
}

/** Words a Windows visitor must never see (machine-words.test.ts). */
export const MAC_ONLY_WORDS = ["Mac", "Apple", "menu bar", "Terminal on", "Applications", "Activity Monitor"] as const;
