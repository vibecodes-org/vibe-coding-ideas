"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { logClientError } from "@/actions/error-log";

export default function IdeaDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    void logClientError({
      message: error.message,
      stack: error.stack,
      digest: error.digest,
      url: typeof window !== "undefined" ? window.location.href : undefined,
      userAgent: typeof window !== "undefined" ? navigator.userAgent : undefined,
      source: "error_boundary_idea",
    }).catch(() => {});
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
      <h2 className="mt-4 text-xl font-semibold">Something went wrong</h2>
      <p className="mt-2 text-muted-foreground">
        {error.message || "Failed to load this idea."}
      </p>
      <Button onClick={reset} className="mt-6">
        Try Again
      </Button>
    </div>
  );
}
