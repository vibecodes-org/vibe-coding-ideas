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
//
// RELOAD-REATTACH (card cbe60db5, design item 8): a reload of THIS window
// gets a fresh nonce with no dock listening on it — the handshake above
// always times out for a reload. `popout-reload-stash.ts` is this window's
// OWN memory of which session it last held (stashed in its own
// sessionStorage the moment a hand-off succeeds); on a handshake timeout we
// check it BEFORE falling to the generic "lost the hand-off" dead end:
//   - no stash at all → genuinely lost (never attached in this window before,
//     or the stash was cleared) — the original dead-end copy, unchanged.
//   - a stash + this window's OWN snapshot for that sid is fresh (<60s) →
//     instant-continue, exactly like the dock's own reload path: reattach
//     silently, no button.
//   - a stash + a stale/absent snapshot → the one-button Reconnect panel
//     (F3's take-over line applies here too — reconnecting always can take
//     over another leg).
//   - the reattach mint itself reports the session gone → the clean "this
//     session has ended" end state + a Close-window button.

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { relayBaseUrl } from "@/lib/terminal/connection";
import {
  popoutChannelName,
  parsePopoutChannelMessage,
  startPopoutClientHandshake,
  type PopoutPayload,
} from "@/lib/terminal/popout-channel";
import { loadSessionSnapshot, isSnapshotFresh, toReconnectBuffer } from "@/lib/terminal/session-snapshot";
import {
  loadPopoutStash,
  savePopoutStash,
  type PopoutStash,
} from "@/lib/terminal/popout-reload-stash";
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

/** Reattach for a stashed session, rebuilding a full `PopoutPayload` from the stash + the mint response + (if any) this window's own fresh snapshot. */
async function reattachForStash(
  stash: PopoutStash,
): Promise<{ ok: true; payload: PopoutPayload } | { ok: false; gone: boolean }> {
  try {
    const res = await fetch("/api/terminal/session/reattach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid: stash.sid }),
    });
    if (!res.ok) return { ok: false, gone: true };
    const data = (await res.json()) as { sessionId: string; browserToken: string };
    const snapshot = loadSessionSnapshot(stash.sid);
    const buffer = snapshot ? toReconnectBuffer(snapshot) : undefined;
    return {
      ok: true,
      payload: {
        sid: data.sessionId,
        browserToken: data.browserToken,
        relayUrl: relayBaseUrl(),
        ideaId: stash.ideaId,
        ideaTitle: stash.ideaTitle,
        label: stash.label,
        identity: stash.identity,
        readOnly: stash.readOnly,
        autoAccept: stash.autoAccept,
        buffer,
      },
    };
  } catch {
    return { ok: false, gone: false };
  }
}

export function TerminalPopoutClient() {
  // Read once, at initial render — a derived, render-time fact about this
  // window (its hash/name), not something that needs its own effect+setState
  // round trip. `null` on the server render (no `window`); corrected the
  // instant this lazy initializer runs client-side, before paint.
  const [nonce] = useState<string | null>(() => (typeof window === "undefined" ? null : resolveNonce()));
  const [payload, setPayload] = useState<PopoutPayload | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  // Reload-reattach (design item 8): a stash found on handshake timeout with
  // no fresh snapshot to auto-continue — the one-button Reconnect panel.
  const [reloadStash, setReloadStash] = useState<PopoutStash | null>(null);
  const [reloadBusy, setReloadBusy] = useState(false);
  const [reloadError, setReloadError] = useState(false);
  const [reloadGone, setReloadGone] = useState(false);
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

  const attachPayload = useCallback((p: PopoutPayload) => {
    setPayload(p);
    savePopoutStash({
      sid: p.sid,
      label: p.label,
      identity: p.identity,
      readOnly: p.readOnly,
      autoAccept: p.autoAccept,
      ideaId: p.ideaId,
      ideaTitle: p.ideaTitle,
    });
  }, []);

  const handleManualReconnect = useCallback(() => {
    if (!reloadStash) return;
    setReloadBusy(true);
    setReloadError(false);
    void (async () => {
      const result = await reattachForStash(reloadStash);
      setReloadBusy(false);
      if (result.ok) {
        setReloadStash(null);
        attachPayload(result.payload);
      } else if (result.gone) {
        setReloadStash(null);
        setReloadGone(true);
      } else {
        setReloadError(true); // network hiccup — stash + button stay, Retry is just clicking again
      }
    })();
  }, [reloadStash, attachPayload]);

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
        attachPayload(p);
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
      // On timeout this ALSO posts "closed" on the channel (same module), so
      // a dock that's still listening auto-reattaches instead of being stuck
      // showing "Popped out" forever with nothing on the other end — that
      // path is unaffected by the reload-reattach recovery below (it's about
      // THIS window's own next render, not the dock's).
      onTimeout: () => {
        const stash = loadPopoutStash();
        if (!stash) {
          setTimedOut(true); // genuinely lost — never attached here before
          return;
        }
        const snapshot = loadSessionSnapshot(stash.sid);
        if (snapshot && isSnapshotFresh(snapshot.savedAt)) {
          // Instant continue (design's veto note, Nick: yes) — this window's
          // OWN <60s snapshot is proof enough; reattach silently.
          void (async () => {
            const result = await reattachForStash(stash);
            if (result.ok) attachPayload(result.payload);
            else if (result.gone) setReloadGone(true);
            else setReloadStash(stash); // network hiccup — fall back to the manual button
          })();
          return;
        }
        setReloadStash(stash);
      },
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
  }, [nonce, attachPayload]);

  // Once `payload` is set, the render below returns the live view BEFORE it
  // ever looks at `timedOut`/reload state — so a late interval tick racing a
  // just-arrived payload is harmless; there's no need to also clear those
  // here.
  if (payload) {
    return <TerminalPopoutView payload={payload} onSessionActions={handleSessionActions} />;
  }

  if (reloadGone) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <Square className="h-7 w-7 text-zinc-400" />
        <div className="text-base font-semibold text-zinc-200">This session has ended</div>
        <p className="max-w-sm text-[13px] text-zinc-400">
          You can close this window — start a new one from the board.
        </p>
        <Button
          variant="outline"
          className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700"
          onClick={() => window.close()}
        >
          Close window
        </Button>
      </div>
    );
  }

  if (reloadStash) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <RefreshCw className={reloadBusy ? "h-7 w-7 animate-spin text-sky-400" : "h-7 w-7 text-sky-400"} />
        <div className="text-base font-semibold text-sky-400">Reconnect this window</div>
        <p className="max-w-sm text-[13px] text-zinc-400">{reloadStash.label}</p>
        <p className="max-w-sm text-[11.5px] text-zinc-500">
          If this session is open somewhere else, reconnecting here takes it over.
        </p>
        <Button
          className="bg-sky-500 text-sky-950 hover:bg-sky-400"
          disabled={reloadBusy}
          onClick={handleManualReconnect}
        >
          <RefreshCw className="h-4 w-4" /> Reconnect
        </Button>
        {reloadError && (
          <p className="text-[11.5px] text-rose-400">Couldn&apos;t reconnect — check your connection and try again.</p>
        )}
      </div>
    );
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
