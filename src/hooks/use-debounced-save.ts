"use client";

import { useEffect, useRef } from "react";

interface UseDebouncedSaveOptions<T> {
  value: T;
  onSave: (value: T) => Promise<void> | void;
  /** Debounce delay in ms (default 600) */
  delayMs?: number;
  /** If true, skip scheduling entirely (e.g. read-only mode) */
  skip?: boolean;
  /** Skip the first effect run — useful when initial value matches server state */
  skipInitial?: boolean;
}

interface UseDebouncedSaveReturn {
  /** Immediately persist the pending value (if any) and cancel the timer. */
  flush: () => Promise<void>;
  /** True while a save is in flight or pending. */
  isPending: () => boolean;
}

/**
 * Debounced auto-save for a value. Saves `delayMs` after the last change.
 * On unmount, any pending save is fired (fire-and-forget).
 * Use the returned `flush()` to persist immediately (e.g. on blur/close).
 */
export function useDebouncedSave<T>({
  value,
  onSave,
  delayMs = 600,
  skip = false,
  skipInitial = true,
}: UseDebouncedSaveOptions<T>): UseDebouncedSaveReturn {
  const valueRef = useRef(value);
  const onSaveRef = useRef(onSave);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef(false);
  const firstRunRef = useRef(true);

  valueRef.current = value;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (skip) return;
    if (firstRunRef.current) {
      firstRunRef.current = false;
      if (skipInitial) return;
    }

    pendingRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      pendingRef.current = false;
      void onSaveRef.current(valueRef.current);
    }, delayMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, delayMs, skip]);

  useEffect(() => {
    return () => {
      if (pendingRef.current) {
        pendingRef.current = false;
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        void onSaveRef.current(valueRef.current);
      }
    };
  }, []);

  async function flush() {
    if (!pendingRef.current) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = false;
    await onSaveRef.current(valueRef.current);
  }

  function isPending() {
    return pendingRef.current;
  }

  return { flush, isPending };
}
