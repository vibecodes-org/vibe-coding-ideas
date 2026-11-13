import { describe, it, expect, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useMediaQuery } from "./use-media-query";

type Fake = { matches: boolean; listeners: Set<() => void> };

function installFake(initial: Record<string, boolean>) {
  const lists = new Map<string, Fake>();
  for (const [q, m] of Object.entries(initial)) {
    lists.set(q, { matches: m, listeners: new Set() });
  }
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (q: string) => {
      const l = lists.get(q) ?? { matches: false, listeners: new Set() };
      lists.set(q, l);
      return {
        get matches() {
          return l.matches;
        },
        media: q,
        addEventListener: (_: string, cb: () => void) => l.listeners.add(cb),
        removeEventListener: (_: string, cb: () => void) =>
          l.listeners.delete(cb),
      };
    },
  });
  return {
    lists,
    set(q: string, m: boolean) {
      const l = lists.get(q)!;
      l.matches = m;
      l.listeners.forEach((cb) => cb());
    },
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
});

describe("useMediaQuery", () => {
  it("is true on first render when the query matches, false otherwise", () => {
    installFake({ "(min-width: 768px)": true, "(max-width: 767px)": false });
    const a = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(a.result.current).toBe(true);
    const b = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(b.result.current).toBe(false);
  });

  it("flips on a change event", () => {
    const fake = installFake({ "(min-width: 768px)": true });
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    act(() => fake.set("(min-width: 768px)", false));
    expect(result.current).toBe(false);
    act(() => fake.set("(min-width: 768px)", true));
    expect(result.current).toBe(true);
  });

  it("removes its listener on unmount", () => {
    const fake = installFake({ q: true });
    const { unmount } = renderHook(() => useMediaQuery("q"));
    expect(fake.lists.get("q")!.listeners.size).toBe(1);
    unmount();
    expect(fake.lists.get("q")!.listeners.size).toBe(0);
  });

  it("switches subscription when the query changes", () => {
    const fake = installFake({ a: true, b: false });
    const { result, rerender } = renderHook(({ q }) => useMediaQuery(q), {
      initialProps: { q: "a" },
    });
    expect(result.current).toBe(true);
    rerender({ q: "b" });
    expect(result.current).toBe(false);
    expect(fake.lists.get("a")!.listeners.size).toBe(0);
    expect(fake.lists.get("b")!.listeners.size).toBe(1);
  });

  it("server render uses the false value without touching window", () => {
    installFake({ q: true });
    function Probe() {
      return createElement("span", null, useMediaQuery("q") ? "yes" : "no");
    }
    expect(renderToString(createElement(Probe))).toContain("no");
  });
});
