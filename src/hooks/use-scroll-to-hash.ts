"use client";

import { useEffect } from "react";

/**
 * Scrolls to an element matching the current URL hash fragment on mount.
 * Used for deep-linking to comments (`#comment-{id}`) and replies (`#reply-{id}`).
 */
export function useScrollToHash() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;

    // Small delay to ensure DOM is rendered (especially for dynamic content)
    const timeout = setTimeout(() => {
      const el = document.querySelector(hash);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // Brief highlight to draw attention
        el.classList.add("ring-2", "ring-primary/50", "rounded-lg");
        setTimeout(() => {
          el.classList.remove("ring-2", "ring-primary/50", "rounded-lg");
        }, 2000);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, []);
}
