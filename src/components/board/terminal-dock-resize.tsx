"use client";

// In-app terminal — user-resizable dock height (Nick's request 2026-08-17,
// card b885ebfd: "let Nick resize the panel height by dragging").
//
// Two pieces, both consumed by terminal-dock.tsx:
//
//   `useDockHeight()` — owns the PREFERRED height (what the user picked, kept
//   in localStorage via lib/terminal/dock-height.ts), tracks the live viewport
//   height, and derives the EFFECTIVE height (preference clamped to the
//   viewport). Returns drag/keyboard/reset callbacks the handle wires up.
//
//   `<TerminalDockResizeHandle>` — the grab strip along the dock's TOP edge.
//   Pointer events (mouse + touch, via pointer capture so a fast drag that
//   leaves the strip keeps tracking), keyboard (ArrowUp/Down, Shift ×4,
//   Home/End) and double-click-to-reset. Exposed as an ARIA `separator` with
//   `aria-valuenow` so screen readers can announce and adjust it.
//
// HOW THE HEIGHT REACHES THE TERMINAL: the dock sets a CSS custom property
// `--vc-term-dock-h` on its root and the per-session body in
// terminal-session-view.tsx sizes itself with `h-[var(--vc-term-dock-h,38vh)]`
// — the pre-this-card `38vh` is the SSR/first-paint fallback (the preference
// is only known after mount, same install-first pattern as dock-open
// persistence). No prop threading through the (many) `TerminalSessionView`
// props, and the existing ResizeObserver in use-terminal-session.ts already
// refits xterm + sends the PTY a resize on any container size change — the
// drag needs no extra plumbing to give live feedback.
//
// COMPOSITION WITH COLLAPSE: resizing and collapsing are independent. The
// handle is only rendered while the dock is expanded (nothing to size when
// collapsed — the body is `hidden`), the CSS variable stays set regardless,
// so the remembered height applies the instant the dock re-expands.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import {
  DOCK_HEIGHT_KEY_STEP_PX,
  MIN_DOCK_HEIGHT_PX,
  clearDockHeight,
  dragDockHeight,
  maxDockHeight,
  readDockHeight,
  resolveDockHeight,
  stepDockHeight,
  writeDockHeight,
} from "@/lib/terminal/dock-height";

/** The CSS custom property the dock root sets and the session body reads. */
export const DOCK_HEIGHT_CSS_VAR = "--vc-term-dock-h";

export type DockHeightController = {
  /** Effective body height in px, or `null` before mount (SSR / first paint → CSS fallback applies). */
  height: number | null;
  /** Inline style for the dock root — sets the CSS variable once the height is known. */
  rootStyle: CSSProperties | undefined;
  /** True while a pointer drag is in flight (for cursor/selection suppression + handle styling). */
  dragging: boolean;
  /** Current clamp bounds for ARIA. */
  minHeight: number;
  maxHeight: number;
  /** Begin a pointer drag from `clientY`. */
  beginDrag: (clientY: number) => void;
  /** Continue a pointer drag at `clientY` — no-op unless `beginDrag` ran. */
  moveDrag: (clientY: number) => void;
  /** Finish the drag and persist the result. */
  endDrag: () => void;
  /** Keyboard nudge (px, positive = taller); persists. */
  nudge: (deltaPx: number) => void;
  /** Jump to the min or max; persists. */
  jumpTo: (edge: "min" | "max") => void;
  /** Forget the preference and go back to the default height. */
  reset: () => void;
};

/** Read the live viewport height, SSR-safe (0 → callers treat as "unknown"). */
function readViewportHeight(): number {
  return typeof window === "undefined" ? 0 : window.innerHeight;
}

export function useDockHeight(): DockHeightController {
  // `preferred` is the user's choice (null = never chosen / use default).
  // `viewportHeight` is 0 until mount so the first paint keeps the CSS
  // fallback — matches the collapsed-initial-paint pattern used everywhere
  // else in the dock (SSR-safe, no hydration mismatch).
  const [preferred, setPreferred] = useState<number | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ y: number; height: number } | null>(null);
  // Mirror of the latest effective height for the drag/keyboard callbacks,
  // so they never close over a stale value mid-gesture.
  const heightRef = useRef<number | null>(null);

  useEffect(() => {
    // Mount-only hydration from two external systems (localStorage + the
    // window size) — the same install-first correction pattern the dock's
    // own `readDockOpen()` effect uses. SSR paints the CSS fallback; this
    // flips to the real preference right after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate the stored preference + viewport on mount
    setPreferred(readDockHeight());
    setViewportHeight(readViewportHeight());
    const onResize = () => setViewportHeight(readViewportHeight());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const height = viewportHeight > 0 ? resolveDockHeight(preferred, viewportHeight) : null;
  useEffect(() => {
    heightRef.current = height;
  }, [height]);

  const commit = useCallback((next: number) => {
    setPreferred(next);
    writeDockHeight(next);
  }, []);

  const beginDrag = useCallback((clientY: number) => {
    const current = heightRef.current;
    if (current === null) return;
    dragStartRef.current = { y: clientY, height: current };
    setDragging(true);
  }, []);

  const moveDrag = useCallback(
    (clientY: number) => {
      const start = dragStartRef.current;
      if (!start) return;
      const vh = readViewportHeight();
      if (vh <= 0) return;
      // Live feedback: update the preference as the pointer moves (cheap —
      // one state write per move; xterm refits via its ResizeObserver and the
      // PTY resize is deduped on cols×rows so the wire only sees real changes).
      // Persisted once on `endDrag`, not per move.
      setPreferred(dragDockHeight(start.height, start.y, clientY, vh));
    },
    [],
  );

  const endDrag = useCallback(() => {
    if (!dragStartRef.current) return;
    dragStartRef.current = null;
    setDragging(false);
    const finalHeight = heightRef.current;
    if (finalHeight !== null) writeDockHeight(finalHeight);
  }, []);

  const nudge = useCallback(
    (deltaPx: number) => {
      const current = heightRef.current;
      const vh = readViewportHeight();
      if (current === null || vh <= 0) return;
      commit(stepDockHeight(current, deltaPx, vh));
    },
    [commit],
  );

  const jumpTo = useCallback(
    (edge: "min" | "max") => {
      const vh = readViewportHeight();
      if (vh <= 0) return;
      commit(edge === "min" ? MIN_DOCK_HEIGHT_PX : maxDockHeight(vh));
    },
    [commit],
  );

  const reset = useCallback(() => {
    setPreferred(null);
    clearDockHeight();
  }, []);

  // Suppress text selection + force the resize cursor page-wide for the
  // duration of a drag (the pointer inevitably crosses the board and the
  // xterm canvas). Restored on the same effect's cleanup — including on
  // unmount mid-drag.
  useEffect(() => {
    if (!dragging) return;
    const body = document.body;
    const prevCursor = body.style.cursor;
    const prevSelect = body.style.userSelect;
    body.style.cursor = "row-resize";
    body.style.userSelect = "none";
    return () => {
      body.style.cursor = prevCursor;
      body.style.userSelect = prevSelect;
    };
  }, [dragging]);

  const rootStyle = height === null ? undefined : ({ [DOCK_HEIGHT_CSS_VAR]: `${height}px` } as CSSProperties);
  const maxHeight = viewportHeight > 0 ? maxDockHeight(viewportHeight) : MIN_DOCK_HEIGHT_PX;

  return {
    height,
    rootStyle,
    dragging,
    minHeight: MIN_DOCK_HEIGHT_PX,
    maxHeight,
    beginDrag,
    moveDrag,
    endDrag,
    nudge,
    jumpTo,
    reset,
  };
}

type TerminalDockResizeHandleProps = {
  controller: DockHeightController;
  className?: string;
};

/**
 * The grab strip on the dock's top edge. Absolutely positioned so it straddles
 * the dock's top border (4px above, 4px below) — a comfortable 8px hit target
 * that doesn't push the collapsed bar down. `touch-none` stops a touch drag
 * from scrolling the page underneath.
 */
export function TerminalDockResizeHandle({ controller, className }: TerminalDockResizeHandleProps) {
  const { height, dragging, minHeight, maxHeight, beginDrag, moveDrag, endDrag, nudge, jumpTo, reset } = controller;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // Primary button / any touch or pen contact only.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    beginDrag(e.clientY);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    // `moveDrag` is a no-op unless a drag began — no need to gate on the
    // (possibly one-render-stale) `dragging` state here.
    moveDrag(e.clientY);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    endDrag();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = DOCK_HEIGHT_KEY_STEP_PX * (e.shiftKey ? 4 : 1);
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        nudge(step);
        break;
      case "ArrowDown":
        e.preventDefault();
        nudge(-step);
        break;
      case "Home":
        e.preventDefault();
        jumpTo("min");
        break;
      case "End":
        e.preventDefault();
        jumpTo("max");
        break;
      default:
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize terminal panel"
      aria-valuemin={minHeight}
      aria-valuemax={maxHeight}
      aria-valuenow={height ?? undefined}
      aria-valuetext={height === null ? undefined : `${height} pixels tall`}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      data-testid="terminal-dock-resize-handle"
      data-dragging={dragging || undefined}
      className={cn(
        "group absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize touch-none select-none outline-none",
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onDoubleClick={reset}
      onKeyDown={onKeyDown}
    >
      {/* Full-width highlight line — visible on hover / drag / keyboard focus. */}
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-x-0 top-1 h-px bg-sky-400 opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-100",
          dragging && "opacity-100",
        )}
      />
      {/* Centred grip pill — the always-visible affordance. */}
      <div
        aria-hidden="true"
        className={cn(
          "absolute left-1/2 top-[3px] h-[3px] w-10 -translate-x-1/2 rounded-full bg-zinc-600 transition-colors group-hover:bg-sky-400 group-focus-visible:bg-sky-400",
          dragging && "bg-sky-400",
        )}
      />
    </div>
  );
}
