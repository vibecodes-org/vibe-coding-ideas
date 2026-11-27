import { toast } from "sonner";
import { toastActionError } from "./stale-version";

/**
 * Show a toast with an "Undo" button that delays the actual server action.
 * The caller should perform optimistic UI updates before calling this.
 *
 * - Immediately shows a toast with the given message + Undo button
 * - After `duration` ms, executes the server action
 * - If Undo is clicked, calls the rollback function and cancels the server action
 * - If the server action fails, calls rollback and shows an error toast
 */
export function undoableAction(opts: {
  message: string;
  execute: () => Promise<void>;
  undo: () => void;
  duration?: number;
  errorMessage?: string;
}) {
  const { message, execute, undo, duration = 5000, errorMessage } = opts;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  timer = setTimeout(async () => {
    if (cancelled) return;
    try {
      await execute();
    } catch (error) {
      undo();
      toastActionError(error, errorMessage ?? "Action failed");
    }
  }, duration);

  toast(message, {
    duration,
    action: {
      label: "Undo",
      onClick: () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        undo();
      },
    },
  });
}
