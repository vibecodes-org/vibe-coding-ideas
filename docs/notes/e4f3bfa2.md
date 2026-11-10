# Card e4f3bfa2 - flaky terminal-dock.test.tsx

## Root cause
`TerminalDock` mirrors `sessions` into `sessionsRef` from a passive effect
(terminal-dock.tsx, the `useEffect` that sets `sessionsRef.current`).
`mintAndDeliver` reads `sessionsRef.current` to decide "reuse the pristine
tab" (`findPristineSlot`, needs exactly 1 entry) or "append a tab".

The seeded pristine tab is committed to the DOM first; the ref catches up one
passive-effect flush later. A test doing `await waitFor(session-view)` then
`requestBrowserLaunch(...)` can resume in that gap (waitFor's MutationObserver
fires right after the commit). The ref still reads [], so the launch appends a
2nd tab -> "Found multiple elements by: [data-testid=session-view]", with the
first tab still showing data-idea-id="" (the CI evidence). Timing depends on
CPU load, which is why it only shows in full CI runs and moves between tests.

## Evidence
- Reproduced locally: 300-iteration loop of the exact sequence, 2 failures in
  ~900 iterations, same error text. After the fix: 0 in 1800.
- Deterministic pin: new test fires the launch from a MutationObserver the
  moment the tab appears -> always 2 tabs.
- Failing CI runs: 42771131059 (master), 42854733048 (PR 425), plus the 24 Oct
  PR 384 runs from the card comments. All "already-mounted tab's own Resume".

## Decision
Test-harness fix, not an app change: added `waitForSeededTab()` (waitFor +
`await act(async () => {})`) and used it at the 10 places that wait for the
seeded tab and then launch. No timeout raised.

## Not changed, flagged
The app's passive-effect ref sync leaves a one-tick window where a launch
could miss the seeded tab. A person cannot hit it (the launch comes from a
click, long after the seed commit), so it is not treated as a product bug. If
wanted, switching that sync to `useLayoutEffect` would close it; left alone
because the card says not to widen scope.

## Ruled out
Fake-timer/timeout theory (no timers involved), leakage between tests (state
is per render; cleanup runs), Node version (reproduces on Node 26 locally).
