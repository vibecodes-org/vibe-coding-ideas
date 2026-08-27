"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Puts keyboard focus on the <main> scroll container whenever a page loads or
 * the route changes, so a keyboard-only user can scroll straight away.
 *
 * The layout scrolls <main>, not the window. Browsers only send arrow / Page
 * Up-Down / Space / Home / End to the scrollable box around the *focused*
 * element — and on a fresh load nothing is focused, so those keys scrolled the
 * (unscrollable) window and did nothing at all. A keyboard user had to Tab
 * into the page first to "wake up" scrolling (Nick, 27 Aug 2026).
 *
 * Only steals focus from <body>: if something else already has it (an
 * autofocused input, a dialog opened from the URL), that wins.
 * `preventScroll` keeps ScrollToTop's reset intact.
 */
export function MainFocus() {
  const pathname = usePathname();

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    main.focus({ preventScroll: true });
  }, [pathname]);

  return null;
}
