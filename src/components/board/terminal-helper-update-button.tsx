"use client";

// In-app terminal — the shared "Update now" button for helper-update nudges
// (card cbe60db5, rework 4). Extracted so every nudge that offers the same
// action renders the exact same affordance — Nick's field test on the
// chooser's nudge: "why didn't you just copy the button rather than add a
// new type of ux?" The My sessions panel (terminal-my-sessions-panel.tsx)
// and the session chooser (terminal-session-chooser.tsx) both render this,
// so they can't drift apart again.

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HelperUpdateButtonProps {
  /** My sessions panel: starts the in-app confirm/quiesce/download flow. */
  onClick?: () => void;
  /** Chooser (and any caller without the panel's update-flow state): a
   *  plain link straight to the download, rendered via the Button's
   *  `asChild` so the markup stays an `<a>` under the hood. */
  href?: string;
  className?: string;
}

export function HelperUpdateButton({ onClick, href, className }: HelperUpdateButtonProps) {
  const buttonClassName = cn("flex-none bg-sky-500 text-sky-950 hover:bg-sky-400", className);
  if (href) {
    return (
      <Button asChild size="xs" className={buttonClassName}>
        <a href={href}>Update now</a>
      </Button>
    );
  }
  return (
    <Button size="xs" className={buttonClassName} onClick={onClick}>
      Update now
    </Button>
  );
}
