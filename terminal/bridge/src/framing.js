// Framing convention between the BROWSER leg and the BRIDGE leg.
//
// The relay forwards every WebSocket frame verbatim and never parses it, so the
// two ends agree on a tiny convention that rides *inside* the frames:
//
//   - BINARY frame  -> opaque terminal bytes (PTY stdout -> browser, and
//                      keystrokes browser -> PTY stdin). Forwarded verbatim.
//   - TEXT frame    -> a JSON control message, e.g. a resize:
//                      {"type":"resize","cols":120,"rows":30}
//
// Keeping control messages as TEXT and data as BINARY lets the bridge tell them
// apart with zero ambiguity (data is never accidentally parsed as JSON), while
// the relay stays fully opaque to both.
//
// These helpers are pure so they can be unit-tested in isolation.

/**
 * Build the wire form of a resize control message (a JSON string sent as TEXT).
 * @param {number} cols
 * @param {number} rows
 * @returns {string}
 */
export function encodeResize(cols, rows) {
  return JSON.stringify({ type: "resize", cols, rows });
}

/**
 * Parse a TEXT control message coming from the browser leg.
 *
 * Returns a normalized control object, or null if the text is not a valid /
 * supported control message (the caller should then ignore it rather than
 * treating it as terminal input — control frames must never reach the PTY).
 *
 * @param {string} text
 * @returns {{type:"resize", cols:number, rows:number} | null}
 */
export function parseControlMessage(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object") return null;

  if (msg.type === "resize") {
    const cols = Number(msg.cols);
    const rows = Number(msg.rows);
    if (!isValidDim(cols) || !isValidDim(rows)) return null;
    return { type: "resize", cols, rows };
  }
  return null;
}

/**
 * A terminal dimension must be a positive, finite, sane integer. Guards the
 * PTY against NaN / 0 / absurd values that could throw or destabilize it.
 * @param {number} n
 * @returns {boolean}
 */
export function isValidDim(n) {
  return Number.isInteger(n) && n > 0 && n <= 1000;
}
