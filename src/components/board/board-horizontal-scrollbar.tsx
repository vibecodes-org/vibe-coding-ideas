"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * A sideways scrollbar for the board that is ALWAYS within reach.
 *
 * The board's columns render at their full content height and the page
 * scrolls vertically as one long page — that is the intended design (Nick,
 * 27 Aug 2026: "I want the full column height still… I just want the vertical
 * page scrollbars fixed"). The trade-off is that the column row's own native
 * horizontal scrollbar sits at the very bottom of that tall row, off-screen
 * until you scroll the page all the way down. Bounding the board to the
 * viewport (a2035c9) fixed that but shrank every column into its own little
 * scroll box, and was reverted.
 *
 * This is the classic "proxy scrollbar": a thin, sticky element pinned to the
 * bottom of the window whose scrollable width mirrors the real row's, with
 * scroll positions synced both ways. Nothing about the columns' height or the
 * page's vertical scroll is touched. It sits above the terminal dock via the
 * same inset variable the page already reserves.
 *
 * Hidden on touch layouts (below `sm`), where the row is swipe-scrolled with
 * snap points and the bar would only get in the way.
 */
export function BoardHorizontalScrollbar({
  scrollContainerRef,
}: {
  /** The real horizontally-scrolling column row. */
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}) {
  const proxyRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [hasOverflow, setHasOverflow] = useState(false);

  const measure = useCallback(() => {
    const real = scrollContainerRef.current;
    if (!real) return;
    setContentWidth(real.scrollWidth);
    setHasOverflow(real.scrollWidth > real.clientWidth + 1);
    const proxy = proxyRef.current;
    if (proxy && proxy.scrollLeft !== real.scrollLeft) proxy.scrollLeft = real.scrollLeft;
  }, [scrollContainerRef]);

  useEffect(() => {
    const real = scrollContainerRef.current;
    if (!real) return;
    measure();

    // Real row scrolled (trackpad, drag edge-scroll, keyboard) → mirror it.
    const onRealScroll = () => {
      const proxy = proxyRef.current;
      if (proxy && proxy.scrollLeft !== real.scrollLeft) proxy.scrollLeft = real.scrollLeft;
    };
    real.addEventListener("scroll", onRealScroll, { passive: true });
    window.addEventListener("resize", measure);

    // Columns added/removed/filtered or the row resized → re-measure. Observing
    // the row's children (not just the row) catches content-width changes the
    // row's own box size doesn't reflect.
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(real);
      for (const child of Array.from(real.children)) observer.observe(child);
    }
    const mutation =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => {
            observer?.disconnect();
            observer?.observe(real);
            for (const child of Array.from(real.children)) observer?.observe(child);
            measure();
          })
        : null;
    mutation?.observe(real, { childList: true });

    return () => {
      real.removeEventListener("scroll", onRealScroll);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
      mutation?.disconnect();
    };
  }, [measure, scrollContainerRef]);

  // Proxy dragged → move the real row. Assigning an equal scrollLeft fires no
  // scroll event, so the two listeners can't ping-pong.
  const onProxyScroll = useCallback(() => {
    const real = scrollContainerRef.current;
    const proxy = proxyRef.current;
    if (real && proxy && real.scrollLeft !== proxy.scrollLeft) real.scrollLeft = proxy.scrollLeft;
  }, [scrollContainerRef]);

  return (
    <div
      ref={proxyRef}
      data-testid="board-horizontal-scrollbar"
      aria-hidden="true"
      onScroll={onProxyScroll}
      className={`sticky z-10 hidden h-3 overflow-x-auto overflow-y-hidden bg-background/90 sm:block ${
        hasOverflow ? "" : "invisible"
      }`}
      style={{ bottom: "var(--vc-term-dock-inset, 0px)" }}
    >
      <div style={{ width: contentWidth, height: 1 }} />
    </div>
  );
}
