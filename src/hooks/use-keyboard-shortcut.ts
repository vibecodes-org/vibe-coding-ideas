import { useEffect } from "react";

export type Shortcut = "mod+b";

/**
 * Bind a global keyboard shortcut. `mod` matches Cmd on Mac and Ctrl elsewhere.
 *
 * Suppressed when the focused element is an input/textarea/contenteditable
 * to avoid stealing focus while the user is typing.
 */
export function useKeyboardShortcut(
  combo: Shortcut,
  handler: (event: KeyboardEvent) => void
) {
  useEffect(() => {
    function listener(event: KeyboardEvent) {
      if (combo !== "mod+b") return;

      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod) return;
      if (event.key.toLowerCase() !== "b") return;

      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        const editable =
          target.isContentEditable ||
          target.getAttribute?.("contenteditable") === "true";
        if (tag === "INPUT" || tag === "TEXTAREA" || editable) {
          return;
        }
      }

      event.preventDefault();
      handler(event);
    }

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [combo, handler]);
}
