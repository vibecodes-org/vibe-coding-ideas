"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "pwa-install-dismissed";
const VISIT_COUNT_KEY = "pwa-visit-count";
const MIN_VISITS = 3;

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIosPrompt, setShowIosPrompt] = useState(false);
  const [dismissed, setDismissed] = useState(true); // default hidden

  useEffect(() => {
    // Don't show if already installed as standalone
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    // Don't show if previously dismissed
    if (localStorage.getItem(DISMISSED_KEY)) return;

    // Track visit count — only show after MIN_VISITS
    const visitCount = Number(localStorage.getItem(VISIT_COUNT_KEY) || "0") + 1;
    localStorage.setItem(VISIT_COUNT_KEY, String(visitCount));
    if (visitCount < MIN_VISITS) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- reveal the prompt after the visit-count threshold (client-only localStorage gating)
    setDismissed(false);

    // Chrome/Edge/Android: intercept native install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // iOS Safari detection
    const isIos =
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(window as unknown as { MSStream?: unknown }).MSStream;
    const isSafari =
      /Safari/.test(navigator.userAgent) &&
      !/CriOS|FxiOS|Chrome/.test(navigator.userAgent);
    if (isIos && isSafari) {
      setShowIosPrompt(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    setDeferredPrompt(null);
    setShowIosPrompt(false);
    localStorage.setItem(DISMISSED_KEY, "1");
  };

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
    }
    dismiss();
  };

  if (dismissed || (!deferredPrompt && !showIosPrompt)) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-lg border bg-card p-4 shadow-lg">
      <button
        onClick={dismiss}
        className="absolute right-2 top-2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>

      {deferredPrompt ? (
        <div className="flex items-center gap-3">
          <Download className="h-8 w-8 shrink-0 text-primary" />
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium">Install VibeCodes</p>
            <p className="text-xs text-muted-foreground">
              Add to your home screen for a better experience.
            </p>
          </div>
          <Button size="sm" onClick={install}>
            Install
          </Button>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <Share className="mt-0.5 h-8 w-8 shrink-0 text-primary" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Install VibeCodes</p>
            <p className="text-xs text-muted-foreground">
              Tap the share button{" "}
              <Share className="inline h-3 w-3" /> then &quot;Add to Home
              Screen&quot; to install.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
