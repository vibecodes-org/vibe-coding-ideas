// The helper's own words that name the machine (card 51d424f7, release 1b).
// The tray menu and the wrong-account notice said "this Mac" and "menu-bar
// icon"; on Windows the helper is a PC with its icon by the clock. The Mac
// wording is unchanged. Pure, so terminal/test/helper-copy.test.mjs can pin it.

/** @param {string} [platform] process.platform */
function signOutLabel(platform = process.platform) {
  return platform === "win32" ? "Sign out this PC" : "Sign out this Mac";
}

/** @param {string} [platform] process.platform */
function wrongAccountNotice(platform = process.platform) {
  return platform === "win32"
    ? "That link is for a different VibeCodes account than this PC's helper. Nothing was started. To switch accounts, choose \"Sign out this PC\" from the VibeCodes icon by the clock."
    : "That link is for a different VibeCodes account than this Mac's helper. Nothing was started. To switch accounts, choose \"Sign out this Mac\" from the helper's menu-bar icon.";
}

module.exports = { signOutLabel, wrongAccountNotice };
