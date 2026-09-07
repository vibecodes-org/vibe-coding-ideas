// Pure control-connection URL/param builder — no Electron, no `ws`, no I/O.
//
// Shared by main.js's connectControl (the PRIMARY standing control
// connection) and connectOpenTerminalControl (the dedicated, throwaway
// open-terminal authorization handshake socket — see the header comment on
// connectOpenTerminalControl in main.js for the regression this split fixes)
// so BOTH dial the relay with an identical param shape. `purpose` is the
// only thing that ever differs between the two callers: the primary
// connection never sets it; the handshake socket always does.
//
// Extracted into its own dependency-free module so this shape is
// independently unit-testable without mocking Electron or `ws` — see
// terminal/test/control-url.test.mjs.

/**
 * @param {{
 *   relayBase: string,
 *   sid: string,
 *   token: string,
 *   helperVersion: string,
 *   machineLabel: string,
 *   alwaysOn: boolean,
 *   availability?: { codex?: boolean, claude?: boolean } | null,
 *   purpose?: "open-terminal",
 * }} args
 * @returns {string} the full relay connect URL (e.g. `wss://relay/?session=...`)
 */
export function buildControlConnectUrl({
  relayBase,
  sid,
  token,
  helperVersion,
  machineLabel,
  alwaysOn,
  availability,
  purpose,
}) {
  const params = new URLSearchParams({
    session: sid,
    role: "helper",
    token,
    helperVersion,
    machineLabel,
    alwaysOn: alwaysOn ? "1" : "0",
  });
  if (availability) {
    params.set("codexInstalled", availability.codex ? "1" : "0");
    params.set("claudeInstalled", availability.claude ? "1" : "0");
  }
  if (purpose) params.set("purpose", purpose);
  return `${relayBase.replace(/\/$/, "")}/?${params}`;
}
