// Pure stay-awake decision for the helper (card f4be2981).
//
// While any session's agent is busy (printed something in the last 2 minutes, as
// reported by its bridge over IPC), the helper holds macOS's "prevent idle sleep"
// power lock so a long task keeps running while the Mac would otherwise doze off.
// The screen still locks and the display still sleeps; closing the lid still
// sleeps the Mac (macOS does not allow that to be prevented). The lock is
// released when no agent is busy any more, or the helper quits.
//
// main.js owns the actual powerSaveBlocker calls; this module only decides.

/** @param {number} busyCount agents currently busy  @param {boolean} currentlyHeld */
function decideStayAwake(busyCount, currentlyHeld) {
  if (busyCount > 0 && !currentlyHeld) return "start";
  if (busyCount <= 0 && currentlyHeld) return "stop";
  return "keep";
}

/** The menu-bar line shown only while the lock is held. */
function stayAwakeLabel(busyCount) {
  return `Keeping this Mac awake: ${busyCount} ${busyCount === 1 ? "agent" : "agents"} working`;
}

module.exports = { decideStayAwake, stayAwakeLabel };
