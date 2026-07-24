// Nagle-style output coalescing for the bridge -> relay leg (MITIGATION 2 —
// Cloudflare free-tier op budget). One ws.send() per PTY onData event turns a
// burst of small writes (e.g. `cat` on a big file, a fast build log) into one
// relay message per chunk. Every relay message costs the relay Durable Object
// a handful of storage ops (see relay/src/activity-throttle.js), so coalescing
// consecutive BINARY chunks into fewer, larger sends reduces relay DO-ops
// spend too, not just the bridge's own send() count.
//
// Rules:
//   - BINARY only. A quiet line (>= coalesceWindowMs since the last actual
//     send) goes out IMMEDIATELY — typing echo must never feel delayed.
//   - Otherwise the chunk is buffered and flushed together after
//     coalesceWindowMs (or sooner if maxBufferBytes is hit — a runaway
//     producer must not grow the buffer unbounded).
//   - TEXT/control frames are NEVER buffered: sendControl() flushes any
//     pending BINARY first (preserving wire order), then sends the control
//     payload immediately.
//   - flush()/close() send whatever is pending — wire these into ws
//     close/error and process shutdown so no tail bytes are silently dropped.
//
// Dependency-injected clock + timer so the coalescing decision is
// unit-testable without relying on real 25ms waits.

export const DEFAULT_COALESCE_WINDOW_MS = 25;
export const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024;

/**
 * @param {object} opts
 * @param {(chunk: Buffer, meta: { binary: boolean }) => void} opts.send
 *   Called with the (possibly coalesced) chunk to actually put on the wire.
 * @param {number} [opts.coalesceWindowMs]
 * @param {number} [opts.maxBufferBytes]
 * @param {() => number} [opts.now]
 * @param {(fn: () => void, ms: number) => any} [opts.setTimer]
 * @param {(handle: any) => void} [opts.clearTimer]
 * @returns {{ queueBinary: (buf: Buffer) => void, sendControl: (payload: string) => void, flush: () => void, close: () => void, pendingBytes: () => number }}
 */
export function createOutputBatcher({
  send,
  coalesceWindowMs = DEFAULT_COALESCE_WINDOW_MS,
  maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
  now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
} = {}) {
  if (typeof send !== "function") {
    throw new TypeError("createOutputBatcher: `send` is required");
  }

  /** @type {Buffer[]} */
  let pending = [];
  let pendingBytes = 0;
  let lastSendAt = -Infinity;
  let timer = null;

  function cancelTimer() {
    if (timer != null) {
      clearTimer(timer);
      timer = null;
    }
  }

  /** Send whatever is currently buffered as ONE frame (no-op if empty). */
  function flush() {
    cancelTimer();
    if (pending.length === 0) return;
    const chunk = pending.length === 1 ? pending[0] : Buffer.concat(pending, pendingBytes);
    pending = [];
    pendingBytes = 0;
    lastSendAt = now();
    send(chunk, { binary: true });
  }

  /** Queue a chunk of opaque BINARY terminal output for coalesced sending. */
  function queueBinary(buf) {
    const t = now();
    if (pending.length === 0 && t - lastSendAt >= coalesceWindowMs) {
      // Quiet line — send immediately, no buffering (instant typing echo).
      lastSendAt = t;
      send(buf, { binary: true });
      return;
    }
    pending.push(buf);
    pendingBytes += buf.length;
    if (pendingBytes >= maxBufferBytes) {
      // Runaway producer — don't let the buffer grow unbounded; flush now.
      flush();
      return;
    }
    if (timer == null) {
      timer = setTimer(() => {
        timer = null;
        flush();
      }, coalesceWindowMs);
      if (timer && typeof timer.unref === "function") timer.unref();
    }
  }

  /**
   * Send a TEXT/control frame. NEVER buffered: flush any pending BINARY
   * first so the peer sees it before the control frame (wire order
   * preserved), then send the control payload right away.
   * @param {string} payload
   */
  function sendControl(payload) {
    flush();
    send(payload, { binary: false });
  }

  return { queueBinary, sendControl, flush, close: flush, pendingBytes: () => pendingBytes };
}
