import { unstable_isUnrecognizedActionError } from "next/navigation";
import { toast } from "sonner";

/**
 * A tab loaded from an older deployment calls server actions by an id the
 * current deployment no longer knows. Vercel skew protection keeps the old
 * deployment reachable for 12 hours; after that every save from the tab fails
 * with Next's UnrecognizedActionError ("Failed to find Server Action"). A
 * refresh fixes it, so say that instead of a generic "Failed to …".
 */
export function isStaleVersionError(error: unknown): boolean {
  if (unstable_isUnrecognizedActionError(error)) return true;
  // Fallback for a duplicated module instance where instanceof fails.
  return (
    error instanceof Error &&
    (error.name === "UnrecognizedActionError" ||
      /Server Action ".*" was not found on the server/.test(error.message))
  );
}

export const STALE_VERSION_TOAST_ID = "stale-version";

export const STALE_VERSION_MESSAGE =
  "VibeCodes has been updated — refresh to keep saving your changes";

/** One persistent toast (fixed id, so repeats don't stack). */
export function showStaleVersionToast() {
  toast.error(STALE_VERSION_MESSAGE, {
    id: STALE_VERSION_TOAST_ID,
    duration: Infinity,
    action: {
      label: "Refresh",
      onClick: () => window.location.reload(),
    },
  });
}

/**
 * For catch blocks: show the refresh toast for a stale-version failure,
 * otherwise the caller's own message. Returns true when it was stale.
 */
export function toastActionError(error: unknown, fallbackMessage: string): boolean {
  if (isStaleVersionError(error)) {
    showStaleVersionToast();
    return true;
  }
  toast.error(fallbackMessage);
  return false;
}
