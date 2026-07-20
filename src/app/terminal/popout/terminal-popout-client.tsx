"use client";

// The popped-out terminal window's client entry point (multi-session stage 4,
// D2/D4/D7). Owns the hand-off HANDSHAKE only — everything about actually
// running a session lives in TerminalPopoutView, mounted once the payload
// arrives.
//
// Nonce resolution: the URL HASH first (what the dock's window.open() sets —
// see terminal-dock.tsx's handlePopOut), falling back to `window.name` per
// the stage brief ("NONCE comes from the URL hash or window.name") — a
// fallback that matters if some intermediate navigation ever drops the hash
// (e.g. a browser "restore session" round-trip); `window.name` persists
// across navigations within the same tab/window in a way the hash doesn't
// survive every code path. Either way the nonce carries NO session meaning by
// itself (see popout-channel.ts's module doc) — it only names the rendezvous
// channel.

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  hasPopoutHandoffTimedOut,
  parsePopoutChannelMessage,
  popoutChannelName,
  type PopoutPayload,
} from "@/lib/terminal/popout-channel";
import { TerminalPopoutView } from "@/components/board/terminal-popout-view";

// The dock's window.open() target name is `vibecodes-terminal-<nonce>` (see
// terminal-dock.tsx's handlePopOut) — that string becomes this window's OWN
// `window.name` automatically, so the fallback strips the same prefix back
// off rather than treating the whole target string as the nonce.
const WINDOW_NAME_PREFIX = "vibecodes-terminal-";

function resolveNonce(): string | null {
  const hash = window.location.hash.replace(/^#/, "").trim();
  if (hash) return hash;
  const name = window.name.trim();
  if (name.startsWith(WINDOW_NAME_PREFIX)) return name.slice(WINDOW_NAME_PREFIX.length) || null;
  return name || null;
}

export function TerminalPopoutClient() {
  // Read once, at initial render — a derived, render-time fact about this
  // window (its hash/name), not something that needs its own effect+setState
  // round trip. `null` on the server render (no `window`); corrected the
  // instant this lazy initializer runs client-side, before paint.
  const [nonce] = useState<string | null>(() => (typeof window === "undefined" ? null : resolveNonce()));
  const [payload, setPayload] = useState<PopoutPayload | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!nonce) return;
    // Keep the nonce in window.name too, so it survives a same-window
    // reload/back-forward that might drop the hash — a cheap, harmless extra
    // (window.name is per-tab, never sent anywhere).
    window.name = nonce;

    const channel = new BroadcastChannel(popoutChannelName(nonce));
    const startedAt = Date.now();

    channel.onmessage = (ev) => {
      const message = parsePopoutChannelMessage(ev.data);
      if (message?.type === "payload") setPayload(message.payload);
    };
    channel.postMessage({ type: "ready" });

    const pollTimer = window.setInterval(() => {
      if (hasPopoutHandoffTimedOut(startedAt, Date.now())) {
        setTimedOut(true);
        window.clearInterval(pollTimer);
      }
    }, 250);

    const sendClosed = () => {
      try {
        channel.postMessage({ type: "closed" });
      } catch {
        /* channel already gone — nothing to signal */
      }
    };
    window.addEventListener("beforeunload", sendClosed);
    window.addEventListener("pagehide", sendClosed);

    return () => {
      window.clearInterval(pollTimer);
      window.removeEventListener("beforeunload", sendClosed);
      window.removeEventListener("pagehide", sendClosed);
      // Deliberately NOT closing the channel or sending "closed" here — this
      // cleanup also runs on React StrictMode's dev double-invoke, which must
      // never look like the user closing the window. Only the real browser
      // lifecycle events above count as "closed".
    };
  }, [nonce]);

  // Once `payload` is set, the render below returns the live view BEFORE it
  // ever looks at `timedOut` — so a late interval tick racing a just-arrived
  // payload is harmless; there's no need to also clear `timedOut` here.
  if (payload) return <TerminalPopoutView payload={payload} />;

  if (!nonce || timedOut) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <AlertTriangle className="h-7 w-7 text-amber-400" />
        <div className="text-base font-semibold text-zinc-200">Lost the session hand-off</div>
        <p className="max-w-sm text-[13px] text-zinc-400">
          This window lost its session hand-off — close it and pop out again.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Loader2 className="h-7 w-7 animate-spin text-sky-400" />
      <div className="text-base font-semibold text-sky-400">Connecting your terminal…</div>
    </div>
  );
}
