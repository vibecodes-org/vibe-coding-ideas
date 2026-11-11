// Wording for the yellow "your Mac is away" bar (card f4be2981, mock scenes 1 and 3).
// One bar covers both "our own link is down" and "the link is up but the Mac is
// away"; after 3 minutes of waiting it switches to the long-wait wording and adds
// an End session link. Nothing here ever ends the session by itself.

export interface ReconnectCopy {
  title: string;
  text: string;
  showEndSession: boolean;
}

export function reconnectCopy(longWait: boolean): ReconnectCopy {
  if (longWait) {
    return {
      title: "Still waiting for your Mac.",
      text: "It may be asleep or have its lid closed. Your session is kept for up to 24 hours from when it started.",
      showEndSession: true,
    };
  }
  return {
    title: "Reconnecting to your session…",
    text: "Your Mac went to sleep or lost its connection. Your session is kept and comes back by itself when your Mac does.",
    showEndSession: false,
  };
}
