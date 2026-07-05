# VibeCodes macOS helper — build, sign, notarize (slice 7)

The helper is the **install-once** piece. It registers the `vibecodes://` URL
scheme and, when the app fires a `vibecodes://launch?…` deep link, runs the
existing **bridge** (`terminal/bridge`) — spawning `claude` in a node-pty PTY and
connecting to the relay as the bridge leg. It is a thin, signable Electron wrapper
around the bridge; **no bridge logic is duplicated** (it `fork`s the bridge with
Electron-as-Node; node-pty 1.x is N-API, so its prebuilt binary loads unchanged).

```
vibecodes://launch?…  →  helper (this app)  →  fork bridge --launch-url
                                                  │
                          node-pty PTY (claude) ──┤
                                                  └── ws → relay (bridge leg)
```

---

## Why Electron (packaging choice)

| Option | Download size | Signing/notarize reliability | Effort | Verdict |
|---|---|---|---|---|
| **Electron + electron-builder** | ~85–95 MB dmg (~240 MB installed) | **Highest** — one command does codesign + notarytool + staple; `open-url` Apple Event handled natively | Lowest | **Chosen** |
| Node SEA in a minimal `.app` | ~70–90 MB | Risky — a bare Node `.app` has **no Cocoa run loop, so it cannot receive the `open-url` Apple Event** that macOS uses to deliver `vibecodes://` activations. Would need an Obj-C shim. | High | Rejected |
| Tauri (Rust + Node sidecar) | ~10 MB shell | Good shell, but you still ship Node for node-pty + a Rust toolchain + sidecar IPC | Highest | Over-engineered |

The decisive point is **URL-scheme delivery**: macOS hands `vibecodes://` launches
to the running app as an Apple Event on its main event loop. Electron exposes this
as `app.on("open-url")` for both cold and warm launches; a plain Node binary can't
receive it without a native Cocoa shim. Electron also bundles Node + signs node-pty
+ notarizes in one step. The cost is bundle size (~90 MB download) — acceptable for
a one-time install, and 65 MB lighter after we drop node-pty's win32 prebuilts.

---

## Prerequisites (one time)

1. **Xcode Command Line Tools** (provides `codesign`, `notarytool`, `stapler`):
   ```bash
   xcode-select --install
   ```
2. **Apple Developer account** (individual is fine — you have this).
3. **Developer ID Application certificate** — create + install into your login keychain:
   - Xcode → Settings → Accounts → your Apple ID → *Manage Certificates* → **+** →
     **Developer ID Application**. (Or create a CSR and download from
     <https://developer.apple.com/account/resources/certificates>.)
   - Confirm it's in the keychain:
     ```bash
     security find-identity -v -p codesigning   # look for "Developer ID Application: <Name> (TEAMID)"
     ```
4. **notarytool credentials** — either an app-specific password OR an App Store
   Connect API key:
   - **App-specific password:** <https://account.apple.com> → Sign-In & Security →
     App-Specific Passwords → generate one (label it e.g. "notarytool").
   - **API key (alternative):** App Store Connect → Users and Access → Integrations →
     **+** → download the `.p8` (note the Key ID + Issuer ID).

---

## Build (signed + notarized)

From `terminal/helper/`:

```bash
npm install            # electron + electron-builder (one time)

# Identity: electron-builder auto-selects the Developer ID Application cert from
# the keychain. To pin one explicitly, set CSC_NAME:
export CSC_NAME="Developer ID Application: <Your Name> (<TEAMID>)"

# notarytool credentials — pick ONE of the two blocks:

# (A) app-specific password
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="<TEAMID>"

# (B) App Store Connect API key
# export APPLE_API_KEY="/abs/path/AuthKey_XXXX.p8"
# export APPLE_API_KEY_ID="XXXX"
# export APPLE_API_ISSUER="aaaa-bbbb-cccc-dddd"

npm run dist           # → dist/VibeCodes-0.1.0-arm64.dmg (+ x64, + .zip)
```

`electron-builder` (config in `electron-builder.yml`) will, in order:
`@electron/rebuild` native deps → package → **codesign** every Mach-O (the app, the
Electron Framework, `pty.node`, and `spawn-helper`) with the Developer ID cert under
the **Hardened Runtime** + `entitlements.mac.plist` → **notarize** via `notarytool`
(reads the env above) → **staple** the ticket. No credentials are written to disk.

> **Entitlements** (`entitlements.mac.plist`) allow JIT, unsigned-executable-memory,
> and `disable-library-validation` — the last is required so the hardened-runtime
> process can load node-pty's `pty.node` and exec `spawn-helper`.

### Verify the result

```bash
APP="dist/mac-arm64/VibeCodes.app"
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dvvv "$APP" 2>&1 | grep -E "Authority|TeamIdentifier|Runtime"
spctl -a -vvv -t install "$APP"          # expect: "source=Notarized Developer ID"  "accepted"
xcrun stapler validate "$APP"            # expect: "The validate action worked!"
```

A successful `spctl` "accepted / Notarized Developer ID" is what makes macOS show
**"VibeCodes" with no unidentified-developer warning** on first open.

---

## Unsigned local build (no cert needed — proves the bundle)

```bash
npm run pack:unsigned    # CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --dir
```

Produces `dist/mac-arm64/VibeCodes.app` (unsigned). Use it to inspect the registered
scheme and resource layout:

```bash
/usr/libexec/PlistBuddy -c "Print :CFBundleURLTypes" \
  dist/mac-arm64/VibeCodes.app/Contents/Info.plist
```

---

## Prove the end-to-end chain (against the LIVE relay)

> **Launch Services hazard (dev runs):** dev runs (`electron main.js`, including
> `verify-helper-launch.mjs`) do **not** touch the OS `vibecodes://` handler by
> default. macOS **ignores** `setAsDefaultProtocolClient`'s path/args, so the
> opt-in dev registration (`VIBECODES_DEV_PROTO_REG=1`) registers the raw
> Electron bundle (`com.github.Electron`) and **steals the scheme from the
> installed app**. Repair: launch `/Applications/VibeCodes.app` once.

`verify-helper-launch.mjs` mints owner-bound tokens with the relay's
`TERMINAL_SESSION_SECRET` (read from `terminal/relay/.dev.vars`), attaches a browser
leg to the **deployed** relay, then drives the helper with a real
`vibecodes://launch?…` URL and asserts the byte round-trip.

```bash
# dev path (electron main.js)
node verify-helper-launch.mjs

# packaged path (the built .app's Resources bridge)
HELPER_BIN="$PWD/dist/mac-arm64/VibeCodes.app/Contents/MacOS/VibeCodes" \
  node verify-helper-launch.mjs
```

Both print `ALL ASSERTIONS PASSED`. (A non-interactive sentinel stands in for
interactive `claude` via the bridge's `BRIDGE_CMD` env seam.)

**What only a signed install can confirm:** registering the scheme with Launch
Services so a *Finder/browser* click on `vibecodes://…` routes to the app (warm
`open-url` Apple Event), and the Gatekeeper "verified developer" badge. The verify
script delivers the URL on the command line — the same handler code, minus the OS
Apple-Event delivery. After `npm run dist` + dragging the app to `/Applications`,
confirm OS routing with:

```bash
open "vibecodes://launch?relay=...&session=...&token=...&cwd=..."
```

---

## Hosting (wiring the download)

The app's install button points at **`/download/terminal-helper`**
(`HELPER_INSTALL_URL` in `src/components/board/terminal-dock.tsx`). To go live:

1. Run `npm run dist` → upload `VibeCodes-<ver>-arm64.dmg` (and `-x64`, or a
   `universal` dmg) to a public URL — e.g. Supabase Storage or a Vercel static
   asset under `vibecodes.co.uk/download/`.
2. Make `/download/terminal-helper` serve (or redirect to) that dmg, ideally with
   light OS/arch detection. Until then the button 404s gracefully.

Bump `version` in `package.json` for each release so artifact names don't collide.
