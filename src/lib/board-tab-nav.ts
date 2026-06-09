/**
 * Board tab navigation helper.
 *
 * The board tabs (Board / Workflows / Agents) keep their active state purely
 * client-side and sync the URL via the History API. `board-page-tabs.tsx`
 * listens for `popstate` to switch the active tab. A plain Next `<Link>` or a
 * bare `history.pushState` does NOT fire `popstate`, so those navigations are
 * silently dead (the URL updates but the visible tab never changes).
 *
 * This helper pushes the new `?tab=…` URL and dispatches a synthetic
 * `popstate` so the listener picks it up — the working pattern previously
 * inlined in `workflows-tab.tsx`. Use it for any control that needs to switch
 * the board tab.
 */

export type BoardTab = "board" | "workflows" | "agents";

export function switchBoardTab(tab: BoardTab): void {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  if (tab === "board") params.delete("tab");
  else params.set("tab", tab);

  const qs = params.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;

  window.history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
