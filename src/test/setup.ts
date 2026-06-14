import "@testing-library/jest-dom/vitest";

// --- localStorage polyfill for Node 26+ under jsdom ---------------------------
//
// Node 26 ships experimental Web Storage globals. `sessionStorage` is available,
// but `localStorage` is gated behind the `--localstorage-file` flag, so when the
// jsdom environment is layered on top, `globalThis.localStorage` resolves to
// `undefined` (the Node global shadows jsdom's implementation). That breaks any
// test that touches `localStorage` even though product code is SSR-safe and only
// reads storage inside a client `useEffect`.
//
// Fix: install a minimal in-memory Storage shim onto `localStorage` ONLY when it
// is missing. (jsdom's own `Storage` class can't be reused directly — its
// constructor is "illegal" outside jsdom's internals.) We deliberately do NOT
// clobber an existing implementation, so if a future Node/jsdom provides a real
// `localStorage` this polyfill quietly steps aside.
function createInMemoryStorage(): Storage {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  return storage;
}

if (typeof globalThis.localStorage === "undefined") {
  const localStorage = createInMemoryStorage();

  // Expose on both globalThis and window — jsdom keeps them as separate refs and
  // code paths may reach for either.
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorage,
    configurable: true,
    writable: true,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      value: localStorage,
      configurable: true,
      writable: true,
    });
  }
}
