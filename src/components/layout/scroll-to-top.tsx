"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Resets the scroll position of the <main> scroll container on route changes.
 * Next.js's built-in scroll restoration only scrolls `window`, but our layout
 * uses a fixed outer div with <main overflow-y-auto> as the actual scroll
 * container — so we need to handle it manually.
 */
export function ScrollToTop() {
  const pathname = usePathname();

  useEffect(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTop = 0;
  }, [pathname]);

  return null;
}
