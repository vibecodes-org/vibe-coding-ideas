// The popped-out terminal window's route (multi-session stage 4, D2).
//
// Deliberately an OPAQUE route per the Design-Review binding note: the sid is
// NEVER in this URL (or the query string, or a static param) — the popped
// window's rendezvous NONCE rides the URL HASH instead (hashes never leave
// the browser, never hit this server component) and the actual session
// credentials cross exclusively over a same-origin BroadcastChannel, after
// the page has mounted client-side. See src/lib/terminal/popout-channel.ts
// and terminal-popout-client.tsx for the hand-off protocol.
//
// Server-side: an ordinary authenticated-page gate (requireAuth — the same
// helper every other protected page in the app uses) plus the feature flag,
// so a popped-out window with the flag off (or before login) renders nothing
// rather than a broken terminal.

import { requireAuth } from "@/lib/auth";
import { isTerminalEnabled } from "@/lib/terminal/connection";
import { TerminalPopoutClient } from "./terminal-popout-client";

export const metadata = {
  title: "Terminal",
  robots: { index: false, follow: false },
};

export default async function TerminalPopoutPage() {
  await requireAuth();

  if (!isTerminalEnabled()) return null;

  return <TerminalPopoutClient />;
}
