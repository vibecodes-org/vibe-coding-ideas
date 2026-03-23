"use client";

import { useScrollToHash } from "@/hooks/use-scroll-to-hash";

/** Drop-in client component that scrolls to the URL hash fragment on mount. */
export function ScrollToHash() {
  useScrollToHash();
  return null;
}
