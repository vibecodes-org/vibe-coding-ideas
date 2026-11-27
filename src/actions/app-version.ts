"use server";

/**
 * No-op server action. The stale-version watcher calls it to find out whether
 * this tab can still reach the server's actions: a tab from an expired
 * deployment gets UnrecognizedActionError instead of `true`.
 */
export async function pingAppVersion(): Promise<true> {
  return true;
}
