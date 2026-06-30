// Mint owner-bound leg tokens for MANUAL relay testing (stands in for the app's
// POST /api/terminal/session endpoint). Uses the shared token module + the same
// TERMINAL_SESSION_SECRET the relay verifies with.
//
// Usage:
//   TERMINAL_SESSION_SECRET=<secret> node mint-token.mjs --session a3f9 [--sub user-1] [--idea idea-1]
//
// Prints JSON: { sessionId, sub, idea, expiresAt, bridgeToken, browserToken }.
// Hand BRIDGE_TOKEN=<bridgeToken> to the bridge and ?token=<browserToken> to the page.

import { mintSessionTokens, newSessionId } from "../shared/session-token.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const secret = process.env.TERMINAL_SESSION_SECRET;
if (!secret) {
  console.error("set TERMINAL_SESSION_SECRET (match the relay's .dev.vars)");
  process.exit(2);
}

const sid = arg("session", newSessionId());
const sub = arg("sub", "manual-user");
const idea = arg("idea", "manual-idea");

const tokens = await mintSessionTokens({ sub, idea, sid, secret });
console.log(
  JSON.stringify(
    {
      sessionId: tokens.sid,
      sub: tokens.sub,
      idea: tokens.idea,
      expiresAt: tokens.exp,
      bridgeToken: tokens.bridge,
      browserToken: tokens.browser,
    },
    null,
    2,
  ),
);
