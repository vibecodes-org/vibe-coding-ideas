// Bounded catch-up buffer for PTY output produced while the relay link is down
// (card f4be2981). A Mac that sleeps or loses Wi-Fi for hours with a busy agent
// must not grow this without limit. Oldest chunks are dropped first; the
// browser forces a redraw after it reattaches, so the screen comes back right
// even if the older output was dropped.

export const DEFAULT_CATCHUP_MAX_BYTES = 1024 * 1024;

export function createCatchupBuffer(maxBytes = DEFAULT_CATCHUP_MAX_BYTES) {
  /** @type {Buffer[]} */
  const chunks = [];
  let bytes = 0;
  let dropped = 0;
  return {
    push(chunk) {
      chunks.push(chunk);
      bytes += chunk.length;
      // Always keep the newest chunk, even if it alone is over the cap.
      while (bytes > maxBytes && chunks.length > 1) {
        const old = chunks.shift();
        bytes -= old.length;
        dropped += old.length;
      }
    },
    shift() {
      const c = chunks.shift();
      if (c) bytes -= c.length;
      return c;
    },
    get length() { return chunks.length; },
    get bytes() { return bytes; },
    get droppedBytes() { return dropped; },
  };
}
