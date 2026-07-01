# Deploying the VibeCodes Terminal Relay (Cloudflare Worker + Durable Object)

The relay is a tiny Cloudflare Worker backed by ONE Durable Object class
(`TerminalRelay`). It opaquely forwards bytes between a `bridge` leg (the user's
local machine) and a single `browser` leg (the in-app terminal). It uses the
**WebSocket Hibernation API** (so an idle session stops billing duration) plus DO
**alarms** for idle / max-duration limits.

> You don't need any of this to develop locally — `npx wrangler dev` runs the real
> Worker + DO offline. This doc is only for putting it on the public internet.

## 0. Prerequisites

- A **Cloudflare account** — create one at <https://dash.cloudflare.com/sign-up>.
- The **Workers Paid plan ($5/mo)**. **Durable Objects are not available on the
  free plan**, and this relay is entirely a Durable Object, so the Paid plan is
  mandatory. Enable it under *Workers & Pages → Plans*.
- Node 18+ locally. Wrangler is already a dev dependency of `terminal/relay`, so
  you can use `npx wrangler …` (no global install needed). To install it globally
  instead: `npm i -g wrangler`.

## 1. Log in

```bash
cd terminal/relay
npx wrangler login          # opens a browser to authorize wrangler against your account
npx wrangler whoami         # confirm the account + email
```

If the machine has no browser (CI/SSH), create an API token instead
(*My Profile → API Tokens → Edit Cloudflare Workers* template) and export it:

```bash
export CLOUDFLARE_API_TOKEN=<token>
```

## 2. Set the session secret (MUST match the app)

The relay verifies app-minted session tokens with `TERMINAL_SESSION_SECRET`
(HMAC-SHA256). It must be **byte-for-byte identical** to the value the VibeCodes
app signs with (its `TERMINAL_SESSION_SECRET` env var). It is a **secret**, never
committed and never placed in `wrangler.toml`:

```bash
npx wrangler secret put TERMINAL_SESSION_SECRET
# paste the SAME value as the app's TERMINAL_SESSION_SECRET, then Enter
```

(The local-dev equivalent is `terminal/relay/.dev.vars`, which is gitignored and
loaded automatically by `wrangler dev` — never used in production.)

The idle / max-duration limits ship as plain `[vars]` in `wrangler.toml`
(`TERMINAL_IDLE_MS = 1800000` / `TERMINAL_MAX_MS = 14400000` → 30 min / 4 h). Tune
them there and re-`deploy`; they are not secrets. If absent, the DO falls back to
the same defaults in code.

## 3. Deploy

```bash
npx wrangler deploy
```

First deploy of a new DO class applies the `[[migrations]]` (`tag = "v1"`,
`new_classes = ["TerminalRelay"]`) automatically. On success wrangler prints the
public URL, e.g.:

```
https://vibecodes-terminal-relay.<your-subdomain>.workers.dev
```

Smoke-test it (the Worker answers a plain GET with 426 / `/healthz` with `ok`):

```bash
curl https://vibecodes-terminal-relay.<your-subdomain>.workers.dev/healthz   # → ok
```

WebSocket scheme: clients connect with **`wss://`** (TLS), not `https://`:

```
wss://vibecodes-terminal-relay.<your-subdomain>.workers.dev/?session=<id>&role=<bridge|browser>&token=<jwt>
```

### Optional: custom domain (`relay.vibecodes.co.uk`)

If the `vibecodes.co.uk` zone is on this Cloudflare account, add a route in the
dashboard (*Workers & Pages → vibecodes-terminal-relay → Settings → Domains &
Routes → Add → Custom Domain*) for `relay.vibecodes.co.uk`. Cloudflare provisions
the cert; the relay is then reachable at `wss://relay.vibecodes.co.uk/…`.

## 4. Point the app at the relay

Set the public env var in the VibeCodes app's **production (Vercel)** project so
the in-app terminal dock attaches its `browser` leg to the deployed relay:

```
NEXT_PUBLIC_TERMINAL_RELAY_URL = wss://relay.vibecodes.co.uk
#   (or) wss://vibecodes-terminal-relay.<your-subdomain>.workers.dev
```

Vercel → Project → Settings → Environment Variables → add for *Production* (and
*Preview* if you want previews to use it), then redeploy. The app reads it via
`relayBaseUrl()` in `src/lib/terminal/connection.ts` (default falls back to the
local `ws://127.0.0.1:8787` for dev). The bridge helper receives the same URL
inside the signed `vibecodes://launch?relay=…` deep link, so there is nothing else
to configure on the bridge side.

> Keep `TERMINAL_SESSION_SECRET` in sync across BOTH places (Vercel app env +
> `wrangler secret`). A mismatch makes every leg fail token verification → the
> relay closes with code `4006` and the dock shows the bad-token error.

## 5. Operate

Tail live logs (metadata only — the relay never logs stream content):

```bash
npx wrangler tail
# or filter: npx wrangler tail --format pretty --status error
```

Roll back to the previous deployed version:

```bash
npx wrangler rollback                 # rolls back the latest deployment
npx wrangler deployments list         # see versions / pick an id
npx wrangler rollback <version-id>    # roll back to a specific version
```

> Durable Object **migrations** (the `[[migrations]]` block) cannot be rolled back
> like code — `wrangler rollback` reverts the Worker script, not a class migration.
> Since this relay only has `v1` (class creation), that's a non-issue today; if you
> later rename/delete the DO class, add a new forward migration tag rather than
> trying to undo one.

## Notes / gotchas

- **Local `wrangler dev` does not forward server-initiated WebSocket close frames
  to clients** for hibernatable sockets (known wrangler/miniflare bug,
  [workers-sdk #1812](https://github.com/cloudflare/workers-sdk/issues/1812) /
  [#10307](https://github.com/cloudflare/workers-sdk/issues/10307)). The DO still
  closes the session correctly server-side (visible in `wrangler dev` logs and
  `wrangler tail`); production workerd delivers the close code/reason to clients as
  expected. The hermetic Node stand-in test proves the client-observed close.
- **One DO instance per session id** (`idFromName(session)`); legs for the same
  session always land on the same instance, which is what makes pairing +
  single-attach + owner-binding work.
