// Is every file of a helper release really there? (card 51d424f7, release 1b)
//
// The site sends Mac and Windows users to files on the release named by
// MINIMUM_RECOMMENDED_HELPER_VERSION. A release missing one (say the Windows
// build failed, or the Mac files weren't uploaded yet) would send someone to a
// "Not Found" page. scripts/check-helper-release.mjs runs this in CI; pure so
// it is testable without the network.

/**
 * @param {string[]} urls every file the release must carry
 * @param {(url: string, init: { method: string, redirect: "follow" }) => Promise<{ ok: boolean, status: number }>} fetchImpl
 * @returns {Promise<{ url: string, ok: boolean, status: number | null }[]>}
 */
export async function checkReleaseFiles(urls, fetchImpl) {
  return Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetchImpl(url, { method: "HEAD", redirect: "follow" });
        return { url, ok: res.ok, status: res.status };
      } catch {
        return { url, ok: false, status: null };
      }
    }),
  );
}

/**
 * The lines CI prints, and whether the check passed.
 * @param {string} version
 * @param {{ url: string, ok: boolean, status: number | null }[]} results
 */
export function releaseReport(version, results) {
  const missing = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "ok     " : "MISSING"} ${r.status ?? "no answer"} ${r.url}`);
  lines.push(
    missing.length === 0
      ? `Helper ${version}: all ${results.length} files are on the release.`
      : `Helper ${version}: ${missing.length} of ${results.length} files are missing. Upload them (or wait for the Windows build) before the site points at this version.`,
  );
  return { ok: missing.length === 0, lines };
}
