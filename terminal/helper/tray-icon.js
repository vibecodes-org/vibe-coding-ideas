// The menu-bar (Tray) icon's pixel data (card cc74a067, always-on follow-up).
//
// Ships only when "Keep helper ready" is on (design §5b) — a resident
// background app should always show a menu-bar presence (Docker Desktop /
// Tailscale convention), never a permanent surface under quit-when-idle.
//
// A single small, self-contained asset: 16x16 RGBA PNG, opaque black filled
// circle on a transparent background, base64-encoded so main.js needs no
// extra build step or bundled image file (electron-builder's `files` list
// stays exactly what main.js require()s — see that file's header comment).
// Passed to Electron as a TEMPLATE image (nativeImage.setTemplateImage(true)
// in main.js): macOS re-tints template images automatically for the active
// menu-bar theme, so one flat black shape is all a monochrome tray icon ever
// needs — no separate light/dark asset.
const TRAY_ICON_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJklEQVR42mNgGKzgPw5MtkaiDaLIgP8k4lEDaGHAwKcDqiRl+gMAPZB7hbRsUn0AAAAASUVORK5CYII=";

module.exports = { TRAY_ICON_PNG_BASE64 };
