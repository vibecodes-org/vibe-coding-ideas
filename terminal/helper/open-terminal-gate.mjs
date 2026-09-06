// Desktop Codex: the RELAY-AUTHORIZATION GATE for `vibecodes://open-terminal`
// (security review Finding 1 — CRITICAL).
//
// BEFORE this fix, main.js's handleOpenTerminalUrl decoded the deep link's
// `helperToken` with `decodeTokenClaims` — a LOCAL, UNVERIFIED base64 decode
// (no HMAC check, no expiry check; see terminal/shared/session-token.mjs's
// own doc comment on that function) — and, as long as the JSON shape looked
// right, wrote a 0700 launch script and ran `open -a Terminal` on it
// regardless of whether the relay ever accepted the token. Any web page could
// fire a forged `helperToken` and get a real Terminal window teed up to run
// `codex` with attacker-chosen `cwd`/`prompt`, gated only by one Enter press.
//
// The helper has no copy of TERMINAL_SESSION_SECRET, so it can never verify a
// token's signature itself — only the RELAY can. The fix: open (or reuse) the
// helper's control connection with an explicit `purpose=open-terminal` marker
// (see terminal/shared/control-frames.mjs's OPEN-TERMINAL RELAY AUTHORIZATION
// header) and WAIT for the relay's authenticated `open-terminal-authorized`
// ack — sent only after `authorizeAttach` genuinely verifies the token — before
// main.js is allowed to write anything to disk or call `open`.
//
// This module is the WAIT itself, kept pure/dependency-free (no ws, no fs, no
// Electron, no network) so it is unit-testable with a fake socket — see
// terminal/test/open-terminal-gate.test.mjs. main.js wires it to the REAL
// control-connection WebSocket it already manages (connectControl) and the
// real `isOpenTerminalAuthorizedFrame` parser.
//
// Deliberately does NOT resolve on a bare "open" event — a REJECTED leg is
// also accept()ed by the relay before being closed (the exact BAD_TOKEN
// pattern every other role already relies on — see relay/src/index.js), so an
// `onopen` alone would prove nothing. Only three outcomes are possible:
//   - a message satisfying `isAuthorizedFrame` arrives  → resolve
//   - the socket closes/errors before that                → reject
//   - `timeoutMs` elapses before either                    → reject
// Fail-closed in every branch: the caller (main.js) must treat ANY rejection
// as "do not open a window".

/** How long the helper will wait for the relay's authorization ack before
 *  giving up and refusing to open a window. Generous enough to cover a real
 *  round trip to the Cloudflare Worker; short enough that a genuinely
 *  unreachable/misconfigured relay fails fast rather than hanging the
 *  request indefinitely. */
export const OPEN_TERMINAL_AUTH_TIMEOUT_MS = 8000;

/**
 * Wait for the relay's authenticated open-terminal ack on an ALREADY-OPEN (or
 * opening) control-connection socket. Adds its OWN temporary "message"/
 * "close" listeners on top of whatever permanent listeners the caller already
 * has on the same socket (an EventEmitter-style `.on`/`.off` pair, exactly
 * like the real `ws` WebSocket) — it never removes or replaces them, and
 * removes its own listeners once settled so it never leaks or double-fires.
 *
 * @param {{ on: (event: string, cb: (...args: any[]) => void) => void,
 *           off?: (event: string, cb: (...args: any[]) => void) => void }} socket
 *   The control-connection socket (real `ws.WebSocket` in production; a fake
 *   EventEmitter-shaped object in tests). May already be open, or still
 *   connecting — this function only listens, it never inspects readyState.
 * @param {{ isAuthorizedFrame: (text: string) => boolean,
 *           timeoutMs?: number,
 *           setTimeoutImpl?: typeof setTimeout,
 *           clearTimeoutImpl?: typeof clearTimeout }} args
 * @returns {Promise<void>} resolves iff the relay's authorization ack arrives
 *   on this socket before any close/error/timeout; otherwise rejects.
 */
export function waitForOpenTerminalAuthorization(
  socket,
  {
    isAuthorizedFrame,
    timeoutMs = OPEN_TERMINAL_AUTH_TIMEOUT_MS,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  },
) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeoutImpl(() => {
      settle(() => reject(new Error("timed out waiting for relay authorization")));
    }, timeoutMs);
    timer.unref?.();

    function cleanup() {
      clearTimeoutImpl(timer);
      try { socket.off?.("message", onMessage); } catch { /* best effort */ }
      try { socket.off?.("close", onClose); } catch { /* best effort */ }
      try { socket.off?.("error", onError); } catch { /* best effort */ }
    }

    function settle(fn) {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    }

    function onMessage(data, isBinary) {
      if (isBinary) return; // this control channel never sends binary
      const text = typeof data === "string" ? data : String(data);
      if (!isAuthorizedFrame(text)) return; // any other control frame is none of this gate's business
      settle(() => resolve());
    }

    function onClose(code, reasonBuf) {
      const reason = reasonBuf ? String(reasonBuf) : "";
      settle(() =>
        reject(
          new Error(
            `control connection closed before authorization (code ${code ?? "?"}${reason ? `: ${reason}` : ""})`,
          ),
        ),
      );
    }

    // A "close" event normally follows "error" for a real WebSocket — leave
    // rejection to onClose so callers see exactly one clear reason, never a
    // race between two. This listener exists only so an error is never left
    // completely unheard by anything watching this socket.
    function onError() {
      /* rejection is handled by the close that follows — see comment above */
    }

    socket.on("message", onMessage);
    socket.on("close", onClose);
    socket.on("error", onError);
  });
}
