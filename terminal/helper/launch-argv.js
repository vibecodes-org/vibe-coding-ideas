// Pull a vibecodes:// link out of a command-line argument list. A link reaches
// the helper this way on a cold start (Windows, and macOS dev runs) and in the
// `second-instance` forward (a second click while the helper is already
// running). On Windows the registered handler is `"<exe>" "%1"`, so the link
// arrives as its own argument; some launchers wrap it in quotes, so tolerate
// that. A `--hidden` login-start marker and the exe path are ignored.

/**
 * @param {unknown} argv
 * @param {string} prefix e.g. "vibecodes://"
 * @returns {string | undefined}
 */
function urlFromArgv(argv, prefix) {
  if (!Array.isArray(argv)) return undefined;
  for (const a of argv) {
    if (typeof a !== "string") continue;
    const s = a.trim().replace(/^"(.*)"$/, "$1");
    if (s.startsWith(prefix)) return s;
  }
  return undefined;
}

module.exports = { urlFromArgv };
