"use client";

import { useCallback, useEffect, useRef } from "react";

import { DOCK_INSET_CSS_VAR, resolveDockInset } from "@/lib/terminal/dock-inset";

/**
 * Publishes the dock's real occupied height to `document.documentElement` as
 * `--vc-term-dock-inset`, so the page underneath can reserve that space
 * (card 534d2049 — cards behind the fixed dock were unreachable by scrolling).
 *
 * Returns a ref callback for the dock's ROOT element. Measuring the root
 * rather than adding up the chrome means every state is handled for free:
 * collapsed bar only, expanded, mid-resize-drag, tab strip present or not,
 * popped-out placeholder. There is no second height to keep in sync.
 *
 * Writes straight to the DOM instead of through React state — a resize drag
 * fires this on every frame, and re-rendering the dock (and the xterm instance
 * inside it) at that rate would be both wasteful and risky.
 *
 * The property is REMOVED on unmount, so a board without a dock (flag off,
 * non-team-member) falls back to the `0px` default and lays out exactly as it
 * did before the dock existed.
 */
export function useDockInset(): (node: HTMLElement | null) => void {
  const nodeRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const publish = useCallback(() => {
    const node = nodeRef.current;
    if (!node) return;
    document.documentElement.style.setProperty(
      DOCK_INSET_CSS_VAR,
      resolveDockInset(node.offsetHeight, window.innerHeight),
    );
  }, []);

  useEffect(() => {
    // A window resize doesn't change the dock's height on its own, but it does
    // move the clamp — and the dock's own body height is viewport-derived, so
    // this keeps the reservation honest either way.
    window.addEventListener("resize", publish);
    return () => {
      window.removeEventListener("resize", publish);
      observerRef.current?.disconnect();
      observerRef.current = null;
      document.documentElement.style.removeProperty(DOCK_INSET_CSS_VAR);
    };
  }, [publish]);

  return useCallback(
    (node: HTMLElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      nodeRef.current = node;

      if (!node) {
        document.documentElement.style.removeProperty(DOCK_INSET_CSS_VAR);
        return;
      }

      publish();
      // Guarded for jsdom and any environment without ResizeObserver: the
      // one-off measurement above still applies, we just stop tracking changes.
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(publish);
      observer.observe(node);
      observerRef.current = observer;
    },
    [publish],
  );
}
