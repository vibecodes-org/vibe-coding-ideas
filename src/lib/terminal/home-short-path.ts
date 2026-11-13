/**
 * Show a project folder the short way: `/Users/you/code/x` becomes `~/code/x`
 * (Mac and Linux), `C:\Users\you\projects\x` becomes `~\projects\x` (Windows).
 * Anything that isn't under a home folder is returned as-is (trimmed).
 */
export function homeShortPath(path: string): string {
  const p = path.trim();
  const posix = /^\/(?:Users|home)\/[^/]+(\/.*)?$/.exec(p);
  if (posix) return posix[1] ? `~${posix[1]}` : "~";
  const win = /^[A-Za-z]:\\Users\\[^\\]+(\\.*)?$/i.exec(p);
  if (win) return win[1] ? `~${win[1]}` : "~";
  return p;
}
