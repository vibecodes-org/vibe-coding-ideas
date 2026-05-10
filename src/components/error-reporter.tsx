"use client";

import { useEffect } from "react";
import { logClientError } from "@/actions/error-log";

/**
 * TEMPORARY diagnostic — intercepts console.error to catch React's component-stack
 * messages (which contain "The above error occurred in the <X> component") and
 * the minified React error itself, then forwards them to the server logger so
 * they show up in Vercel runtime logs.
 *
 * Mounted once in the root layout. Remove once the board drag-drop crash is
 * fully diagnosed.
 */
export function ErrorReporter() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const reported = new Set<string>();

    function stringifyArg(a: unknown): string {
      if (a instanceof Error) {
        return `${a.name}: ${a.message}\n${a.stack ?? ""}`;
      }
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    }

    function report(message: string, source: string) {
      // Dedupe so a single crash doesn't fire 50 server actions
      const key = message.slice(0, 200);
      if (reported.has(key)) return;
      reported.add(key);

      void logClientError({
        message: message.slice(0, 8000),
        url: window.location.href,
        userAgent: navigator.userAgent,
        source,
      }).catch(() => {
        // Swallow — don't loop on reporter errors
      });
    }

    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      originalConsoleError(...args);
      try {
        const message = args.map(stringifyArg).join(" ");
        if (
          message.includes("Minified React error") ||
          message.includes("Maximum update depth") ||
          message.includes("occurred in the") ||
          message.includes("at KanbanBoard") ||
          message.includes("at BoardTaskCard") ||
          message.includes("at BoardColumn")
        ) {
          report(message, "console.error");
        }
      } catch {
        // ignore
      }
    };

    const onError = (e: ErrorEvent) => {
      const msg = `${e.message}\n  at ${e.filename}:${e.lineno}:${e.colno}${
        e.error?.stack ? `\n${e.error.stack}` : ""
      }`;
      report(msg, "window.error");
    };

    const onUnhandled = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const msg = reason instanceof Error
        ? `Unhandled rejection: ${reason.message}\n${reason.stack ?? ""}`
        : `Unhandled rejection: ${stringifyArg(reason)}`;
      report(msg, "unhandledrejection");
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);

    return () => {
      console.error = originalConsoleError;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, []);

  return null;
}
