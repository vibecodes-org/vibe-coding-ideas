"use client";

import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type NudgeBannerVariant =
  | "violet"
  | "emerald"
  | "amber"
  | "cyan"
  | "rose"
  | "default";

interface NudgeBannerAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface NudgeBannerProps {
  icon: ReactNode;
  title: string;
  description: string | ReactNode;
  action?: NudgeBannerAction;
  secondaryAction?: NudgeBannerAction;
  variant?: NudgeBannerVariant;
  dismissKey?: string;
  sessionDismissKey?: string;
  compact?: boolean;
  className?: string;
}

const variantStyles: Record<
  NudgeBannerVariant,
  { bg: string; border: string; actionBg: string; actionText: string }
> = {
  violet: {
    bg: "bg-violet-500/[0.04]",
    border: "border-violet-500/20",
    actionBg: "bg-violet-500 hover:bg-violet-400",
    actionText: "text-white",
  },
  emerald: {
    bg: "bg-emerald-500/[0.04]",
    border: "border-emerald-500/20",
    actionBg: "bg-emerald-500 hover:bg-emerald-400",
    actionText: "text-white",
  },
  amber: {
    bg: "bg-amber-500/[0.04]",
    border: "border-amber-500/20",
    actionBg: "bg-amber-500 hover:bg-amber-400",
    actionText: "text-zinc-950",
  },
  cyan: {
    bg: "bg-cyan-500/[0.04]",
    border: "border-cyan-500/20",
    actionBg: "bg-cyan-500 hover:bg-cyan-400",
    actionText: "text-white",
  },
  rose: {
    bg: "bg-rose-500/[0.04]",
    border: "border-rose-500/20",
    actionBg: "bg-rose-500 hover:bg-rose-400",
    actionText: "text-white",
  },
  default: {
    bg: "bg-muted/50",
    border: "border-border",
    actionBg: "bg-primary hover:bg-primary/90",
    actionText: "text-primary-foreground",
  },
};

function ActionButton({
  action,
  variant,
  isPrimary,
}: {
  action: NudgeBannerAction;
  variant: NudgeBannerVariant;
  isPrimary: boolean;
}) {
  const styles = variantStyles[variant];
  const className = isPrimary
    ? cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
        styles.actionBg,
        styles.actionText
      )
    : "inline-flex items-center justify-center whitespace-nowrap rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

  if (action.href) {
    return (
      <Link href={action.href} className={className}>
        {action.label}
      </Link>
    );
  }
  return (
    <button onClick={action.onClick} className={className}>
      {action.label}
    </button>
  );
}

export function NudgeBanner({
  icon,
  title,
  description,
  action,
  secondaryAction,
  variant = "default",
  dismissKey,
  sessionDismissKey,
  compact = false,
  className,
}: NudgeBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(false);

  const isDismissable = !!(dismissKey || sessionDismissKey);

  useEffect(() => {
    try {
      if (dismissKey && localStorage.getItem(dismissKey) === "true") {
        setDismissed(true);
      }
      if (
        sessionDismissKey &&
        sessionStorage.getItem(sessionDismissKey) === "true"
      ) {
        setDismissed(true);
      }
    } catch {
      // Storage unavailable
    }
    setMounted(true);
  }, [dismissKey, sessionDismissKey]);

  if (!mounted || dismissed) return null;

  const handleDismiss = () => {
    setVisible(false);
    // Allow exit animation to complete before removing from DOM
    setTimeout(() => {
      setDismissed(true);
      try {
        if (dismissKey) localStorage.setItem(dismissKey, "true");
        if (sessionDismissKey)
          sessionStorage.setItem(sessionDismissKey, "true");
      } catch {
        // Storage unavailable
      }
    }, 200);
  };

  const styles = variantStyles[variant];

  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border px-4 py-2.5 transition-all duration-200",
          styles.bg,
          styles.border,
          !visible && "h-0 overflow-hidden border-0 py-0 opacity-0",
          className
        )}
        role="status"
      >
        <span className="shrink-0 text-sm">{icon}</span>
        <p className="flex-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{title}</span>
          {" — "}
          {typeof description === "string" ? description : description}
        </p>
        {action && <ActionButton action={action} variant={variant} isPrimary />}
        {isDismissable && (
          <button
            onClick={handleDismiss}
            className="shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-muted-foreground"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-all duration-200",
        styles.bg,
        styles.border,
        !visible && "h-0 overflow-hidden border-0 p-0 opacity-0",
        className
      )}
      role="status"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
        {/* Icon */}
        <span className="mt-0.5 shrink-0 text-base">{icon}</span>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {isDismissable && (
              <button
                onClick={handleDismiss}
                className="shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-muted-foreground sm:hidden"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {description}
          </div>
        </div>

        {/* Actions */}
        {(action || secondaryAction || isDismissable) && (
          <div className="flex shrink-0 flex-row gap-2 sm:flex-col">
            {action && (
              <ActionButton action={action} variant={variant} isPrimary />
            )}
            {secondaryAction && (
              <ActionButton
                action={secondaryAction}
                variant={variant}
                isPrimary={false}
              />
            )}
            {isDismissable && (
              <button
                onClick={handleDismiss}
                className="hidden shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-muted-foreground sm:block"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
