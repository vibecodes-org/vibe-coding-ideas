"use client";

// The popped-out terminal window's client entry point (multi-session stage 4,
// D2/D4/D7). Owns the hand-off HANDSHAKE only — everything about actually
// running a session lives in TerminalPopoutView, mounted once the payload
// arrives.
//
// Nonce resolution: the URL HASH first (what the dock's window.open() sets —
// see terminal-dock.tsx's handlePopOut / openPopoutWindow in
// popout-channel.ts), falling back to `window.name` per the stage brief
// ("NONCE comes from the URL hash or window.name") — a fallback that matters
// if some intermediate navigation ever drops the hash (e.g. a browser
// "restore session" round-trip); `window.name` persists across navigations
// within the same tab/window in a way the hash doesn't survive every code
// path. This fallback is only genuinely reachable now that the dock opens
// WITHOUT `noopener` (board task 4f9cf03d): per the HTML spec, `noopener`
// forces a new browsing context's name to the empty string, so while
// `noopener` still shipped, `window.name` here was ALWAYS empty and this
// fallback was silently dead code — the hash was the only nonce source that
// could ever actually work. Either way the nonce carries NO session meaning
// by itself (see popout-channel.ts's module doc) — it only names the
// rendezvous channel.

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  popoutChannelName,
  parsePopoutChannelMessage,
  startPopoutClientHandshake,
  type PopoutPayload,
} from "@/lib/terminal/popout-channel";
import { TerminalPopoutView } from "@/components/board/terminal-popout-view";
import type { TerminalSessionActions } from "@/components/board/use-terminal-session";

// The dock's window.open() target name is `vibecodes-terminal-<nonce>` (see
// openPopoutWindow in popout-channel.ts) — NOW that the feature string omits
// `noopener`, that string genuinely becomes this window's OWN `window.name`
// automatically, so the fallback strips the same prefix back off rather than
// treating the whole target string as the nonce.
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
  // Scrollback transfer (card 35cffc10): TerminalPopoutView's live session
  // actions, handed up via onSessionActions the same way terminal-dock.tsx's
  // TerminalSessionView reports into its parent's actionsMapRef — this
  // window has no dock chrome to register into, so a single ref is enough.
  // `null` until the view mounts AND its useTerminalSession instance is
  // ready, which doubles as the "have we actually attached yet?" signal
  // below (sendClosed / the bring-back-request reply both read it).
  const sessionActionsRef = useRef<TerminalSessionActions | null>(null);
  // Stable identity so TerminalPopoutView's registration effect doesn't churn
  // on every render of this component (same reasoning as terminal-dock.tsx's
  // own registerActions).
  const handleSessionActions = useCallback((actions: TerminalSessionActions | null) => {
    sessionActionsRef.current = actions;
  }, []);

  useEffect(() => {
    if (!nonce) return;
    // Keep the nonce in window.name too, so it survives a same-window
    // reload/back-forward that might drop the hash — a cheap, harmless extra
    // (window.name is per-tab, never sent anywhere).
    window.name = nonce;

    const channel = new BroadcastChannel(popoutChannelName(nonce));

    // Rework (fix/terminal-popout-handshake): this used to post "ready"
    // exactly once. A Brave field test showed that one message can be lost
    // (privacy/storage isolation around a `noopener` popup, or just an
    // ordinary scheduling race) with NO way to recover — the dock's channel
    // never hears anything, so it never sends the payload, and this window
    // sits waiting for the full 5s before giving up. startPopoutClientHandshake
    // re-announces "ready" every ~300ms until the payload arrives or the
    // hand-off times out, and the dock now treats every "ready" as a reason
    // to (re)send — see createDockPopoutMessageHandler / reduceDockHandshake.
    const stopHandshake = startPopoutClientHandshake({
      channel,
      onPayload: (p) => {
        setPayload(p);
        // Scrollback transfer, Flow B (design §3): once attached, this same
        // channel switches roles from "waiting for the hand-off" to
        // "answering bring-back-request" — safe to reassign onmessage here
        // because the handshake driver's own handler already latched
        // `settled = true` (it's the very thing that just called this
        // callback) and permanently no-ops from now on; nothing double-
        // handles a later message.
        channel.onmessage = (ev) => {
          const message = parsePopoutChannelMessage(ev.data);
          if (message?.type !== "bring-back-request") return;
          const buffer = sessionActionsRef.current?.serializeNow();
          // null = session not attached yet (shouldn't happen once payload
          // has landed, but never worth a throw) — skip the reply; the
          // dock's own 500ms timeout covers it (D3's deliberate fallback).
          if (!buffer) return;
          try {
            channel.postMessage({ type: "buffer-reply", buffer });
          } catch {
            /* channel already gone — nothing to reply to */
          }
        };
      },
      // On timeout this ALSO posts "closed" on the channel (same module),
      // so a dock that's still listening auto-reattaches instead of being
      // stuck showing "Popped out" forever with nothing on the other end.
      onTimeout: () => setTimedOut(true),
    });

    // Flow C (design §4): closing this window pushes the FULL serialized
    // scrollback (pre-pop-out history it was handed, plus everything
    // produced since) immediately before "closed" — BroadcastChannel's
    // per-sender ordering guarantees the reply lands first. Before this
    // window has actually attached (`sessionActionsRef.current` still null —
    // still mid hand-off, or the hand-off never completed), there's nothing
    // to serialize, so this is exactly today's "closed" alone. Bounded and
    // never-throws (design E4): a serialize failure — or simply having
    // nothing to send — falls straight through to "closed" alone rather
    // than blocking it.
    const sendClosed = () => {
      try {
        const buffer = sessionActionsRef.current?.serializeNow();
        if (buffer) {
          try {
            channel.postMessage({ type: "buffer-reply", buffer });
          } catch {
            /* channel already gone — still try "closed" below */
          }
        }
      } catch {
        /* serialize blew up — skip straight to "closed" alone (E4) */
      }
      try {
        channel.postMessage({ type: "closed" });
      } catch {
        /* channel already gone — nothing to signal */
      }
    };
    window.addEventListener("beforeunload", sendClosed);
    window.addEventListener("pagehide", sendClosed);

    return () => {
      stopHandshake();
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
  if (payload) {
    return <TerminalPopoutView payload={payload} onSessionActions={handleSessionActions} />;
  }

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
