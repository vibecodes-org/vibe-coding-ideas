"use client";

import { useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  type LaunchMode,
  MAX_DEEP_LINK_URL_LENGTH,
  buildClaudeDeepLink,
  buildBoardBootstrapPrompt,
  buildCompactPromptEssentials,
  buildLaunchCommand,
  fitCompactWorktreeProtocol,
} from "@/lib/launch-claude-code";
import { logger } from "@/lib/logger";

/**
 * Shared "Launch Claude Code" client logic — the single source of truth for the
 * custom-scheme deep link + its visibility-race fallback + the copy-command
 * fallback. Extracted from the board's `LaunchClaudeCodeButton` so EVERY MCP
 * surface (onboarding, dashboard checklist, connection banner, board) drives one
 * launch implementation rather than duplicating the race/fallback handling.
 *
 * The deep link auto-connects MCP: every bootstrap prompt is prefixed with the
 * `mcpSetupHead` block, so pressing Launch both connects the hosted connector
 * (human-in-the-loop) AND picks up the user's board work for this idea.
 *
 * Launch is desktop-only (the `claude-cli://` scheme has no handler on a phone);
 * callers gate visibility with `useMediaQuery`. The copy-command fallback is
 * always provided so non-Claude-Code / web users can still connect.
 */

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || "https://vibecodes.co.uk";

// Visibility-race window: if the page never blurs/hides within this, assume no
// handler picked up the deep link and offer the copy-command fallback.
const SCHEME_RACE_MS = 1200;

export interface UseLaunchClaudeCodeArgs {
  ideaId: string;
  ideaTitle: string;
  /** Idea github_url (raw); resolved internally for the repo / clone step. */
  ideaGithubUrl?: string | null;
}

export interface UseLaunchClaudeCodeResult {
  /** Fire the deep link (with copy-command fallback on the visibility race). */
  launch: () => void;
  /** Copy the `cd … && claude "…"` command to the clipboard. */
  copyCommand: () => Promise<void>;
}

/**
 * Build the board-bootstrap prompt for an idea. Repo-backed ideas resolve the
 * working copy via the deep link's `repo` slug; repo-less ideas default to a
 * brand-new `~/projects/<slug>` the launched agent creates (mode "new").
 */
function promptFor(
  ideaId: string,
  ideaTitle: string,
  ideaGithubUrl: string | null | undefined
): { prompt: string; mode: LaunchMode } {
  const mode: LaunchMode = ideaGithubUrl ? "existing" : "new";
  const prompt = buildBoardBootstrapPrompt({
    appUrl: APP_URL,
    ideaId,
    ideaTitle,
    mode,
    repoUrl: ideaGithubUrl,
  });
  return { prompt, mode };
}

export function useLaunchClaudeCode({
  ideaId,
  ideaTitle,
  ideaGithubUrl,
}: UseLaunchClaudeCodeArgs): UseLaunchClaudeCodeResult {
  // In-flight guard: blocks a second launch during the visibility-race window so
  // rapid double-clicks don't fire two assigns + two fallback timers.
  const launchingRef = useRef(false);
  const router = useRouter();

  const copyCommand = useCallback(async () => {
    const { prompt, mode } = promptFor(ideaId, ideaTitle, ideaGithubUrl);
    const command = buildLaunchCommand({ prompt, mode, repoUrl: ideaGithubUrl });
    try {
      await navigator.clipboard.writeText(command);
      toast.success("Launch command copied — paste it in your terminal");
    } catch (err) {
      logger.error("launch-claude-code copy failed", { err });
      toast.error("Couldn't copy the launch command");
    }
  }, [ideaId, ideaTitle, ideaGithubUrl]);

  const launch = useCallback(() => {
    // Ignore re-entry while a launch is mid-flight (double-click / Enter+click).
    if (launchingRef.current) return;
    launchingRef.current = true;

    // Deep link uses the COMPACT prompt — the claude-cli:// URL has an OS length
    // ceiling and over-long URLs silently fail to launch. (The copy-command
    // fallback keeps the verbose prompt; a shell arg has no such limit.) Built
    // as essentials (BUG1 fix — path-length-independent head, worktree
    // protocol kept separate) so fitCompactWorktreeProtocol can decide
    // whether the protocol fits the budget — the same shared helper
    // launch-claude-code-button's openInClaudeCode uses, rather than sending
    // an untruncated prompt that can push the URL past the OS ceiling for a
    // real title/path.
    const mode: LaunchMode = ideaGithubUrl ? "existing" : "new";
    const repo = ideaGithubUrl ?? undefined;
    const essentials = buildCompactPromptEssentials({
      appUrl: APP_URL,
      ideaId,
      ideaTitle,
      mode,
      repoUrl: ideaGithubUrl,
    });
    const base = buildClaudeDeepLink({ prompt: "", repo });
    const budget = MAX_DEEP_LINK_URL_LENGTH - base.length;
    const prompt = fitCompactWorktreeProtocol(essentials, budget);
    const link = buildClaudeDeepLink({ prompt, repo });

    let handled = false;
    const markHandled = () => {
      handled = true;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") handled = true;
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", markHandled);
    window.addEventListener("pagehide", markHandled);

    function cleanup() {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", markHandled);
      window.removeEventListener("pagehide", markHandled);
    }

    // Fire the deep link via a transient hidden anchor click rather than
    // window.location.assign. Setting window.location to a custom scheme drops
    // the document into a "navigating" state that CANCELS the client-side
    // router.push below — so the board navigation never happens. An anchor click
    // triggers the OS handler WITHOUT touching the page's own navigation, so the
    // route completes cleanly.
    try {
      const a = document.createElement("a");
      a.href = link;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      // Some browsers throw synchronously on a blocked custom scheme.
      cleanup();
      launchingRef.current = false;
      logger.warn("launch-claude-code deep link blocked", { err });
      toast.error("Your browser blocked the launch", {
        description: "Copy the command and run it in your terminal instead.",
        action: { label: "Copy command", onClick: () => void copyCommand() },
      });
      return;
    }

    // Land the user on this idea's board — Launch is a "go work on it" action and
    // only makes sense there. This hook is used ONLY off-board (dashboard
    // checklist, onboarding, MCP banner), so always navigate. Because the deep
    // link was fired via an anchor (above), the page was never put into a
    // navigating state, so this route completes.
    router.push(`/ideas/${ideaId}/board`);

    window.setTimeout(() => {
      cleanup();
      launchingRef.current = false;
      // A custom-scheme launch can't be reliably confirmed: when the browser
      // shows its native "Open Claude Code?" prompt the page fires no
      // blur/visibilitychange, so `handled` stays false even on success. A lost
      // document focus (app switch OR that native prompt) means it almost
      // certainly launched — treat it as handled. Otherwise show a NEUTRAL
      // nudge, not a red error, since it most likely opened anyway.
      if (handled || !document.hasFocus()) return;
      toast("Opening Claude Code…", {
        description: "Didn't open? Copy the command and run it in your terminal.",
        action: { label: "Copy command", onClick: () => void copyCommand() },
      });
    }, SCHEME_RACE_MS);
  }, [ideaId, ideaTitle, ideaGithubUrl, copyCommand, router]);

  return useMemo(() => ({ launch, copyCommand }), [launch, copyCommand]);
}
