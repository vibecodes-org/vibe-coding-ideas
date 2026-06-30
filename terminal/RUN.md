# Terminal — Slice 1: bridge ↔ relay ↔ browser round-trip

This is **slice 1** of the in-app local Claude Code terminal: it proves the byte
round-trip through a local relay. Nothing here is wired into the Next.js app yet.

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

Terminal 2 — run the same three assertions against it:

```bash
cd terminal/test && RELAY_URL=ws://127.0.0.1:8787 node verify-against-relay.mjs
```

## Manual visual check (xterm.js)

With `wrangler dev` running, start a bridge on a chosen session, then open the page:

```bash
# Terminal 2 — bridge running a cheap interactive shell on session "a3f9"
cd terminal/bridge && RELAY_URL=ws://127.0.0.1:8787 SESSION_ID=a3f9 node src/index.js --cmd "bash"

# Terminal 3 — serve the page and open it
cd terminal/test && python3 -m http.server 5500
#   then open http://127.0.0.1:5500/page.html , set session = a3f9 , click Connect
```

Type in the page → it reaches the PTY → output streams back. Resize the window →
the PTY resizes.

## End-to-end with REAL `claude` (manual)

The bridge defaults to running `claude`. Point it at a real project and attach
the browser leg:

```bash
cd terminal/relay && npx wrangler dev                                  # terminal 1
cd terminal/bridge && RELAY_URL=ws://127.0.0.1:8787 SESSION_ID=a3f9 \
  node src/index.js --cwd ~/path/to/your/project                       # terminal 2 (runs `claude`)
# open terminal/test/page.html , session = a3f9 , Connect                # terminal 3
```

> Automated tests deliberately use a cheap non-interactive sentinel command, not
> interactive `claude`, so CI never hangs.

## Bridge flags

| flag | env | default | meaning |
|---|---|---|---|
| `--relay <ws-url>` | `RELAY_URL` | `ws://localhost:8787` | relay base URL |
| `--session <id>` | `SESSION_ID` | random | session id to pair on |
| `--cmd <command…>` | `BRIDGE_CMD` | `claude` | command to run in the PTY |
| `--cwd <dir>` | `BRIDGE_CWD` | cwd | PTY working directory |
| `--max-seconds <n>` | `BRIDGE_MAX_SECONDS` | `28800` | hard self-kill safety cap |
| `--connect-timeout-ms <n>` | — | `30000` | fail if relay never opens |

## Stubbed for later slices

- **Auth / ownership** — the relay accepts any session id. See
  `relay/src/pairing.js` → `// TODO(slice 2): validate app-minted session token +
  owner binding` and the matching note in `relay/src/index.js`.
- **In-app panel** (the board terminal dock), the **Launch Claude Code menu**,
  the signed `vibecodes://` deep link, helper **code-signing/notarization**, and
  **lifecycle limits** (idle / max-duration UI, reconnect) — all later slices.
