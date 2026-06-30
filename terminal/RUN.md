# Terminal — bridge ↔ relay ↔ browser (slices 1–2)

- **Slice 1** — the byte round-trip through a local relay.
- **Slice 2** — **auth + ownership**: the VibeCodes app mints short-lived,
  owner-bound session tokens; the relay verifies them and refuses any leg that
  isn't the owning user. The in-app panel is still a later slice.

```
 sentinel / claude --[node-pty PTY]--> BRIDGE --ws--> RELAY (CF DO) --ws--> BROWSER leg
                                       (local Node)   (opaque forward)       (xterm.js)
```

- **`bridge/`** — Node process: runs a command in a `node-pty` PTY and pipes it
  opaquely over an outbound WebSocket to the relay. Forwards PTY output → ws
  (binary), ws → PTY stdin (binary), and resize control frames (text/JSON) →
  `pty.resize`. On macOS it `chmod +x`'s node-pty's `spawn-helper` first.
- **`relay/`** — Cloudflare Worker + Durable Object (one DO per `session`). Pairs
  one `bridge` leg with one `browser` leg and forwards bytes verbatim, never
  parsing stream content (metadata only). Enforces single-attach.
- **`test/`** — automated round-trip proof, a plain-ws stand-in relay, a manual
  xterm.js page, and unit tests.

## Prerequisites

```bash
cd terminal/bridge && npm install   # node-pty + ws
cd terminal/relay  && npm install   # wrangler (Cloudflare local dev)
cd terminal/test   && npm install   # ws
```

### Session token secret (slice 2)

Both the app and the relay sign/verify with one shared secret,
`TERMINAL_SESSION_SECRET` (HMAC-SHA256). It NEVER lives in code.

- **App:** set `TERMINAL_SESSION_SECRET` in `.env.local` (see `.env.example`).
- **Relay (local):** put it in `terminal/relay/.dev.vars` (gitignored), which
  `wrangler dev` loads automatically:
  ```
  TERMINAL_SESSION_SECRET=<same-value-as-the-app>
  ```
- **Relay (prod):** `wrangler secret put TERMINAL_SESSION_SECRET`.

## Auth model (slice 2)

The app endpoint `POST /api/terminal/session` (authenticated VibeCodes user) mints
**two** short-lived (~5 min) tokens for one session id — one per leg — via the
shared module `terminal/shared/session-token.mjs`:

```
token = base64url(JSON{sub,sid,idea,role,iat,exp}) . base64url(HMAC-SHA256(payload, secret))
```

Both legs carry the same `sub` (Supabase user id) and `sid`. Each leg passes its
token to the relay as the **`token` query param**
(`/?session=<sid>&role=<bridge|browser>&token=<jwt>`). The relay (same shared
`authorizeAttach`) verifies signature + expiry + that `sid`/`role` match, then
**owner-binds** the session to `sub`: the bridge and browser legs must share the
same `sub`, or the second leg is closed. Close codes: `4005` owner-mismatch,
`4006` invalid/tampered/expired token (in addition to slice-1 `4001`/`4002`
single-attach).

## Run the automated proof (no Cloudflare needed)

Uses the Node stand-in relay, which shares the exact pairing/single-attach logic
with the real Durable Object. Fully hermetic, hard timeouts, exits non-zero on
failure.

```bash
cd terminal/test && npm test          # roundtrip.test.mjs
```

Unit tests for the pure bits:

```bash
cd terminal/relay  && npm test        # pairing / single-attach state machine
cd terminal/bridge && npm test        # framing (control vs data, resize)
```

## Verify against the REAL Cloudflare DO (`wrangler dev`, offline)

Terminal 1 — start the relay (local workerd, no Cloudflare account):

```bash
cd terminal/relay && npx wrangler dev          # serves http://127.0.0.1:8787
```

Terminal 2 — run the assertions against it (mints owner-bound tokens with the
SAME secret as the relay's `.dev.vars`):

```bash
cd terminal/test && TERMINAL_SESSION_SECRET=<same-as-.dev.vars> \
  RELAY_URL=ws://127.0.0.1:8787 node verify-against-relay.mjs
```

Proves: (a) PTY output reaches the browser, (b) keystroke round-trip, (c)
single-attach, (d) owner-mismatch rejected (4005), (e) expired token rejected
(4006) — all through the real Durable Object.

## Manual visual check (xterm.js)

With `wrangler dev` running, mint a token pair, start a bridge with the bridge
token, then open the page with the browser token:

```bash
# Terminal 2 — mint owner-bound tokens for session "a3f9" (stands in for the app)
cd terminal/test && TERMINAL_SESSION_SECRET=<same-as-.dev.vars> \
  node mint-token.mjs --session a3f9        # prints bridgeToken + browserToken

# Terminal 2 — bridge running a cheap interactive shell on session "a3f9"
cd terminal/bridge && RELAY_URL=ws://127.0.0.1:8787 SESSION_ID=a3f9 \
  BRIDGE_TOKEN=<bridgeToken> node src/index.js --cmd "bash"

# Terminal 3 — serve the page and open it
cd terminal/test && python3 -m http.server 5500
#   then open http://127.0.0.1:5500/page.html , set session = a3f9 ,
#   paste the browserToken, click Connect
```

> The `page.html` from slice 1 has no token field yet (the real token UI is the
> slice-3 in-app panel). For a quick manual check, append `&token=<browserToken>`
> to the ws URL it builds, or use `verify-against-relay.mjs` which is fully wired.

Type in the page → it reaches the PTY → output streams back. Resize the window →
the PTY resizes.

## End-to-end with REAL `claude` (manual)

The bridge defaults to running `claude`. Point it at a real project and attach
the browser leg:

```bash
cd terminal/relay && npx wrangler dev                                  # terminal 1
# mint a token pair (see above), then:
cd terminal/bridge && RELAY_URL=ws://127.0.0.1:8787 SESSION_ID=a3f9 \
  BRIDGE_TOKEN=<bridgeToken> node src/index.js --cwd ~/path/to/your/project   # terminal 2 (runs `claude`)
# open the page with the browserToken (see note above)                  # terminal 3
```

> Automated tests deliberately use a cheap non-interactive sentinel command, not
> interactive `claude`, so CI never hangs.

## Bridge flags

| flag | env | default | meaning |
|---|---|---|---|
| `--relay <ws-url>` | `RELAY_URL` | `ws://localhost:8787` | relay base URL |
| `--session <id>` | `SESSION_ID` | random | session id to pair on |
| `--token <jwt>` | `BRIDGE_TOKEN` | — | **required** app-minted `bridge`-role token |
| `--cmd <command…>` | `BRIDGE_CMD` | `claude` | command to run in the PTY |
| `--cwd <dir>` | `BRIDGE_CWD` | cwd | PTY working directory |
| `--max-seconds <n>` | `BRIDGE_MAX_SECONDS` | `28800` | hard self-kill safety cap |
| `--connect-timeout-ms <n>` | — | `30000` | fail if relay never opens |

## Stubbed for later slices

- **In-app panel** (the board terminal dock), the **Launch Claude Code menu**,
  the signed `vibecodes://` deep link, helper **code-signing/notarization**, and
  **lifecycle limits** (idle / max-duration UI, reconnect) — all later slices.
