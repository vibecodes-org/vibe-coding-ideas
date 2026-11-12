// Card f0a13bde (follow-up): the bridge's start-up calls to the app (the
// session key, the board's agents) used to make ONE attempt with a 5 s limit
// and give up silently. A slow first answer from the app (a cold server) then
// left the whole session without encryption, messaging and board agents, and
// nothing said so. This retries the failures worth retrying and reports the
// final outcome so the caller can say so in the terminal.

/** Gaps between attempts: three attempts in all. */
export const STARTUP_FETCH_RETRY_DELAYS_MS = [1000, 3000];

/**
 * Is this HTTP status worth another try? Server errors and rate limits are;
 * a refusal (401, 400, 404) will say the same thing again.
 * @param {number} status
 */
export function isRetryableStatus(status) {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * One POST with a time limit. Never throws.
 * @returns {Promise<{ ok: true, body: unknown } | { ok: false, retryable: boolean, reason: string }>}
 */
export async function postJsonOnce(url, payload, { timeoutMs, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, retryable: isRetryableStatus(res.status), reason: `http ${res.status}` };
    }
    return { ok: true, body: await res.json() };
  } catch (e) {
    const aborted = e?.name === "AbortError" || controller.signal.aborted;
    return { ok: false, retryable: true, reason: aborted ? `timed out after ${timeoutMs}ms` : String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST with retries on network errors, time-outs and server errors only.
 * Never throws.
 * @returns {Promise<{ ok: true, body: unknown, attempts: number } | { ok: false, reason: string, attempts: number }>}
 */
export async function postJsonWithRetry(
  url,
  payload,
  { timeoutMs, fetchImpl = fetch, delaysMs = STARTUP_FETCH_RETRY_DELAYS_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), shouldStop = () => false },
) {
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const result = await postJsonOnce(url, payload, { timeoutMs, fetchImpl });
    if (result.ok) return { ok: true, body: result.body, attempts };
    const delay = delaysMs[attempts - 1];
    if (!result.retryable || delay === undefined || shouldStop()) {
      return { ok: false, reason: result.reason, attempts };
    }
    await sleep(delay);
    if (shouldStop()) return { ok: false, reason: result.reason, attempts };
  }
}

/**
 * The visible terminal line when a start-up fetch failed for good. Plain
 * words: what's missing and what to do. Null when nothing is missing.
 * @param {{ keyFailed: boolean, agentsFailed: boolean }} what
 */
export function startupFailureLine({ keyFailed, agentsFailed }) {
  if (!keyFailed && !agentsFailed) return null;
  const missing = keyFailed
    ? agentsFailed
      ? "encryption, messages from other sessions and the board's agents"
      : "encryption and messages from other sessions"
    : "the board's agents";
  return `\r\n\x1b[33m⚠ VibeCodes couldn't reach the website while this session started, so ${missing} are off for it. Close this session and open a new one to get them back.\x1b[0m\r\n\r\n`;
}
