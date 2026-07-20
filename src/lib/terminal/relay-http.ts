// In-app terminal — the relay's plain-HTTP base URL (multi-session stage 3).
//
// The relay serves both a WebSocket upgrade (the browser/bridge legs) AND, as
// of this stage, a plain HTTP POST /end (My-sessions "End" / "End all") from
// the SAME Worker/host — see terminal/relay/src/index.js. The browser talks
// to it over `wss://`/`ws://` (src/lib/terminal/connection.ts →
// relayBaseUrl(), driven by NEXT_PUBLIC_TERMINAL_RELAY_URL); the end route
// runs SERVER-SIDE and needs the plain-HTTP equivalent of that SAME url —
// this is that one conversion, so the relay host is configured in exactly
// ONE place (NEXT_PUBLIC_TERMINAL_RELAY_URL) rather than a second server-only
// env var that could drift from it.

import { DEFAULT_RELAY_URL } from "@/lib/terminal/connection";

/** `wss://host` → `https://host`, `ws://host` → `http://host`. Pure. */
export function toHttpRelayUrl(relayUrl: string): string {
  if (relayUrl.startsWith("wss://")) return `https://${relayUrl.slice("wss://".length)}`;
  if (relayUrl.startsWith("ws://")) return `http://${relayUrl.slice("ws://".length)}`;
  return relayUrl;
}

/** The relay's plain-HTTP base URL, server-side. */
export function relayHttpBaseUrl(
  raw: string | undefined = process.env.NEXT_PUBLIC_TERMINAL_RELAY_URL,
): string {
  return toHttpRelayUrl(raw || DEFAULT_RELAY_URL);
}
