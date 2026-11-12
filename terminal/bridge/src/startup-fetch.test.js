// Card f0a13bde follow-up: start-up fetches retry, then say so if they fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isRetryableStatus, postJsonWithRetry, startupFailureLine } from "./startup-fetch.js";

const noSleep = async () => {};
const okRes = (body) => ({ ok: true, status: 200, json: async () => body });
const errRes = (status) => ({ ok: false, status, json: async () => ({}) });

test("server errors, time-outs and rate limits are retried; refusals are not", () => {
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(408), true);
  assert.equal(isRetryableStatus(401), false);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(404), false);
});

test("a network error then success comes back on the second attempt", async () => {
  let calls = 0;
  const slept = [];
  const r = await postJsonWithRetry("https://a/x", { sid: "s" }, {
    timeoutMs: 50,
    sleep: async (ms) => slept.push(ms),
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error("ECONNRESET");
      return okRes({ delivered: true });
    },
  });
  assert.deepEqual(r, { ok: true, body: { delivered: true }, attempts: 2 });
  assert.deepEqual(slept, [1000]);
});

test("gives up after three attempts and reports the last reason", async () => {
  let calls = 0;
  const r = await postJsonWithRetry("https://a/x", {}, {
    timeoutMs: 50,
    sleep: noSleep,
    fetchImpl: async () => {
      calls += 1;
      return errRes(502);
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(r, { ok: false, reason: "http 502", attempts: 3 });
});

test("a 401 is not retried", async () => {
  let calls = 0;
  const r = await postJsonWithRetry("https://a/x", {}, {
    timeoutMs: 50,
    sleep: noSleep,
    fetchImpl: async () => {
      calls += 1;
      return errRes(401);
    },
  });
  assert.equal(calls, 1);
  assert.equal(r.ok, false);
});

test("a slow answer times out and is retried", async () => {
  let calls = 0;
  const r = await postJsonWithRetry("https://a/x", {}, {
    timeoutMs: 20,
    sleep: noSleep,
    fetchImpl: (_u, init) => {
      calls += 1;
      if (calls === 1) {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        });
      }
      return Promise.resolve(okRes({ ok: 1 }));
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
});

test("stops retrying once the session is shutting down", async () => {
  let calls = 0;
  const r = await postJsonWithRetry("https://a/x", {}, {
    timeoutMs: 50,
    sleep: noSleep,
    shouldStop: () => calls >= 1,
    fetchImpl: async () => {
      calls += 1;
      throw new Error("offline");
    },
  });
  assert.equal(calls, 1);
  assert.equal(r.ok, false);
});

test("the terminal line says what is off and what to do, and nothing when all is well", () => {
  assert.equal(startupFailureLine({ keyFailed: false, agentsFailed: false }), null);
  const both = startupFailureLine({ keyFailed: true, agentsFailed: true });
  assert.match(both, /encryption, messages from other sessions and the board's agents/);
  assert.match(both, /open a new one/);
  assert.match(startupFailureLine({ keyFailed: true, agentsFailed: false }), /encryption and messages from other sessions are off/);
  assert.match(startupFailureLine({ keyFailed: false, agentsFailed: true }), /the board's agents are off/);
});
