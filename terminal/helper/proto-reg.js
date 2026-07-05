// Dev-mode gate for registering the vibecodes:// scheme.
//
// On macOS, app.setAsDefaultProtocolClient IGNORES its path/args arguments —
// Launch Services registers whichever bundle is currently running. In dev that
// bundle is the raw Electron binary (com.github.Electron), so registering from
// a dev run STEALS the vibecodes:// handler from the installed
// /Applications/VibeCodes.app. Dev registration is therefore OFF by default
// and opt-in only, via VIBECODES_DEV_PROTO_REG=1 (exactly "1").
//
// Pure CJS, no electron import — unit-testable under plain node
// (terminal/test/proto-reg.test.mjs).

function shouldRegisterProtocolInDev(env) {
  return env?.VIBECODES_DEV_PROTO_REG === "1";
}

module.exports = { shouldRegisterProtocolInDev };
