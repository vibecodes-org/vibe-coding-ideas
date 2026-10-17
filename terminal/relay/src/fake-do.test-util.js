// Test-only fakes for driving TerminalRelay without workerd (card 6b2cb8ac).
// Not a test file itself (no `.test.` suffix match for node --test's default
// glob: it's named *.test-util.js), imported by bridge-end.test.js and
// helper-legs.test.js.

/** In-memory DurableObjectStorage: get/put/delete/list + one alarm. */
export function makeFakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const storage = {
    alarm: null,
    async get(key) {
      return map.has(key) ? map.get(key) : undefined;
    },
    async put(key, value) {
      map.set(key, value);
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) map.delete(k);
    },
    async setAlarm(at) {
      storage.alarm = at;
    },
    async deleteAlarm() {
      storage.alarm = null;
    },
    _map: map,
  };
  return storage;
}

let socketSeq = 0;

/** A hibernatable-socket stand-in recording sends and closes. */
export function makeSocket(attachment = {}) {
  let att = attachment;
  const s = {
    id: ++socketSeq,
    tags: [],
    sent: [],
    closes: [],
    accepted: false,
    send: (frame) => s.sent.push(frame),
    close: (code, reason) => s.closes.push([code, reason]),
    accept: () => {
      s.accepted = true;
    },
    serializeAttachment: (a) => {
      att = a;
    },
    deserializeAttachment: () => att,
  };
  return s;
}

/** DurableObjectState with tag-filtered getWebSockets (oldest first) + acceptWebSocket. */
export function makeFakeState(storage, sockets = []) {
  return {
    storage,
    sockets,
    acceptWebSocket(ws, tags) {
      ws.tags = tags;
      sockets.push(ws);
    },
    getWebSockets(tag) {
      if (tag == null) return sockets.slice();
      return sockets.filter((s) => s.tags.includes(tag));
    },
    setWebSocketAutoResponse() {},
  };
}

/** A socket already registered under its role tags (as if accepted earlier). */
export function makeLiveSocket(state, role, sub = "user-A", extra = {}) {
  const ws = makeSocket({ role, sub, ...extra });
  state.acceptWebSocket(ws, [`role:${role}`, `sub:${sub}`]);
  return ws;
}

/**
 * Run `fn` with WebSocketPair/Response stubbed the way workerd provides them
 * (Node's Response refuses status 101). Returns `{ result, server }` where
 * `server` is the server half the relay accepted or closed.
 */
export async function withWorkerGlobals(fn) {
  const saved = { WebSocketPair: globalThis.WebSocketPair, Response: globalThis.Response };
  const created = [];
  globalThis.WebSocketPair = function WebSocketPair() {
    const client = makeSocket();
    const server = makeSocket();
    created.push(server);
    return [client, server];
  };
  const RealResponse = saved.Response;
  globalThis.Response = function FakeResponse(body, init = {}) {
    if (init.status === 101) return { status: 101, webSocket: init.webSocket };
    return new RealResponse(body, init);
  };
  try {
    const result = await fn();
    return { result, server: created[created.length - 1] ?? null, servers: created };
  } finally {
    globalThis.WebSocketPair = saved.WebSocketPair;
    globalThis.Response = saved.Response;
  }
}

/** Capture fetch() calls (the session-closed callback) while `fn` runs. */
export async function captureFetch(fn) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200 };
  };
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
  return calls;
}
