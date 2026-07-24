// Unit tests for the bridge's output-coalescing batcher (MITIGATION 2).
// Run: cd terminal/bridge && node --test   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOutputBatcher } from "./output-batcher.js";

/** A controllable fake clock + timer so coalescing is deterministic and instant. */
function makeFakeScheduler() {
  let now = 0;
  let nextHandle = 1;
  const timers = new Map(); // handle -> { fireAt, fn }
  return {
    now: () => now,
    advance(ms) {
      now += ms;
      for (const [handle, t] of [...timers.entries()]) {
        if (t.fireAt <= now) {
          timers.delete(handle);
          t.fn();
        }
      }
    },
    setTimer: (fn, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { fireAt: now + ms, fn });
      return handle;
    },
    clearTimer: (handle) => {
      timers.delete(handle);
    },
    pendingTimerCount: () => timers.size,
  };
}

function makeSends() {
  const sends = [];
  return { sends, send: (chunk, meta) => sends.push({ chunk, meta }) };
}

test("a quiet line sends immediately (no buffering)", () => {
  const clock = makeFakeScheduler();
  const { sends, send } = makeSends();
  const batcher = createOutputBatcher({ send, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

  batcher.queueBinary(Buffer.from("hello"));

  assert.equal(sends.length, 1);
  assert.equal(sends[0].chunk.toString(), "hello");
  assert.deepEqual(sends[0].meta, { binary: true });
  assert.equal(clock.pendingTimerCount(), 0);
});

test("a burst of onData events within the coalesce window produces ONE send", () => {
  const clock = makeFakeScheduler();
  const { sends, send } = makeSends();
  const batcher = createOutputBatcher({ send, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

  // First chunk goes out immediately (quiet line).
  batcher.queueBinary(Buffer.from("a"));
  assert.equal(sends.length, 1);

  // A burst right behind it, all inside the 25ms window, must coalesce.
  clock.advance(1);
  batcher.queueBinary(Buffer.from("b"));
  clock.advance(1);
  batcher.queueBinary(Buffer.from("c"));
  clock.advance(1);
  batcher.queueBinary(Buffer.from("d"));

  assert.equal(sends.length, 1, "burst chunks must not send individually while buffered");

  // Timer fires at the coalesce deadline -> ONE more send with the concatenated bytes.
  clock.advance(25);
  assert.equal(sends.length, 2);
  assert.equal(sends[1].chunk.toString(), "bcd");
  assert.deepEqual(sends[1].meta, { binary: true });
});

test("a chunk arriving after the quiet window sends immediately again", () => {
  const clock = makeFakeScheduler();
  const { sends, send } = makeSends();
  const batcher = createOutputBatcher({ send, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

  batcher.queueBinary(Buffer.from("first"));
  assert.equal(sends.length, 1);

  clock.advance(100); // well past the 25ms coalesce window, line is quiet
  batcher.queueBinary(Buffer.from("second"));
  assert.equal(sends.length, 2);
  assert.equal(sends[1].chunk.toString(), "second");
});

test("exceeding maxBufferBytes flushes immediately instead of waiting out the timer", () => {
  const clock = makeFakeScheduler();
  const { sends, send } = makeSends();
  const batcher = createOutputBatcher({
    send,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    maxBufferBytes: 8,
  });

  batcher.queueBinary(Buffer.from("1234")); // immediate (quiet line)
  assert.equal(sends.length, 1);

  clock.advance(1);
  batcher.queueBinary(Buffer.from("5678")); // buffered (4 bytes, under cap)
  assert.equal(sends.length, 1);
  clock.advance(1);
  batcher.queueBinary(Buffer.from("90")); // now 6 bytes buffered, still under cap
  assert.equal(sends.length, 1);
  clock.advance(1);
  batcher.queueBinary(Buffer.from("AB")); // 8 bytes -> cap hit -> immediate flush
  assert.equal(sends.length, 2);
  assert.equal(sends[1].chunk.toString(), "567890AB");
  assert.equal(clock.pendingTimerCount(), 0, "the coalesce timer must be cancelled on cap-triggered flush");
});

test("sendControl flushes pending BINARY first, then sends the control frame — ordering preserved", () => {
  const clock = makeFakeScheduler();
  const { sends, send } = makeSends();
  const batcher = createOutputBatcher({ send, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

  batcher.queueBinary(Buffer.from("x")); // immediate
  clock.advance(1);
  batcher.queueBinary(Buffer.from("y")); // buffered, timer armed

  batcher.sendControl('{"type":"resize","cols":80,"rows":24}');

  assert.equal(sends.length, 3);
  assert.deepEqual(sends[0].meta, { binary: true });
  assert.equal(sends[0].chunk.toString(), "x");
  assert.deepEqual(sends[1].meta, { binary: true });
  assert.equal(sends[1].chunk.toString(), "y", "buffered binary must flush BEFORE the control frame");
  assert.deepEqual(sends[2].meta, { binary: false });
  assert.equal(sends[2].chunk, '{"type":"resize","cols":80,"rows":24}');
  assert.equal(clock.pendingTimerCount(), 0, "the coalesce timer must be cancelled once its data is flushed early");
});

test("sendControl with nothing pending just sends the control frame", () => {
  const clock = makeFakeScheduler();
  const { sends, send } = makeSends();
  const batcher = createOutputBatcher({ send, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

  batcher.sendControl('{"type":"resize","cols":80,"rows":24}');
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].meta, { binary: false });
});

test("close()/flush() sends whatever is pending (e.g. on ws close/error)", () => {
  const clock = makeFakeScheduler();
  const { sends, send } = makeSends();
  const batcher = createOutputBatcher({ send, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

  batcher.queueBinary(Buffer.from("p")); // immediate
  clock.advance(1);
  batcher.queueBinary(Buffer.from("q")); // buffered

  assert.equal(sends.length, 1);
  batcher.close();
  assert.equal(sends.length, 2);
  assert.equal(sends[1].chunk.toString(), "q");

  // Closing again with nothing pending is a harmless no-op.
  batcher.close();
  assert.equal(sends.length, 2);
});

test("flush() with nothing pending is a no-op", () => {
  const clock = makeFakeScheduler();
  const { sends, send } = makeSends();
  const batcher = createOutputBatcher({ send, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  batcher.flush();
  assert.equal(sends.length, 0);
});

test("createOutputBatcher requires a send function", () => {
  assert.throws(() => createOutputBatcher({}), TypeError);
});
