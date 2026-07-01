"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Terminal, ChevronDown, Copy, FolderCog, FolderPlus, ExternalLink, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePostHog } from "posthog-js/react";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  type LaunchMode,
  type LaunchPathState,
  type RecordedProjectPath,
  buildClaudeDeepLink,
  buildLaunchCommand,
  buildBoardBootstrapPrompt,
  buildTaskBootstrapPrompt,
  buildCompactBootstrapPrompt,
  readLaunchPath,
  resolveEffectiveLaunchTarget,
  slugifyIdeaTitle,
  composeNewProjectPath,
  DEFAULT_NEW_PROJECT_PARENT,
} from "@/lib/launch-claude-code";
import { LaunchPathDialog } from "./launch-path-dialog";
import { isTerminalEnabled } from "@/lib/terminal/connection";
import { isBrowserLaunchAvailable, requestBrowserLaunch } from "@/lib/terminal/launch-mode";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || "https://vibecodes.co.uk";
const INSTALL_GUIDE_URL = "https://docs.claude.com/en/docs/claude-code";
// Visibility-race window: if the page never blurs/hides within this, assume no handler.
const SCHEME_RACE_MS = 1200;

interface BaseProps {
  ideaId: string;
  ideaTitle: string;
  ideaGithubUrl: string | null;
  /**
   * Absolute paths the agent recorded for this user + idea (one per machine).
   * No-repo launches inject one as cwd via chooseLaunchCwd (option (a): only
   * when exactly one is recorded). Empty/omitted → first-launch flow.
   */
  recordedProjectPaths?: RecordedProjectPath[];
}

interface BoardLaunchProps extends BaseProps {
  variant: "board";
}

interface TaskLaunchProps extends BaseProps {
  variant: "task-icon" | "task-menu-item";
  taskId: string;
  taskTitle: string;
}

type LaunchClaudeCodeButtonProps = BoardLaunchProps | TaskLaunchProps;

export function LaunchClaudeCodeButton(props: LaunchClaudeCodeButtonProps) {
  const { ideaId, ideaTitle, ideaGithubUrl, recordedProjectPaths } = props;
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // The user's saved localStorage config, mirrored into state so a save in the
  // dialog (or an open from another tab) re-renders the dropdown immediately.
  // Lazily initialised — readLaunchPath is SSR-safe (returns null on the server).
  const [savedState, setSavedState] = useState<LaunchPathState | null>(() =>
    readLaunchPath(ideaId)
  );

  // Re-read localStorage (call after a dialog save or when the dropdown opens, so
  // we never show a stale path).
  const refreshSaved = useCallback(() => {
    setSavedState(readLaunchPath(ideaId));
  }, [ideaId]);

  // Single source of truth for DISPLAY + LAUNCH cwd. The saved existing-mode path
  // (localStorage — what "Set exact folder" writes) takes precedence over the
  // agent-recorded DB path, so the dropdown's path line and the launched cwd can
  // never diverge. Repo-backed ideas resolve via the `repo` slug → no cwd.
  const effectiveTarget = useMemo(
    () =>
      resolveEffectiveLaunchTarget({
        hasRepo: !!ideaGithubUrl,
        saved: savedState,
        recordedPaths: recordedProjectPaths,
      }),
    [ideaGithubUrl, savedState, recordedProjectPaths]
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<LaunchMode | undefined>(undefined);
  // When true, the dialog continues into a launch after saving.
  const [pendingLaunch, setPendingLaunch] = useState(false);
  // In-flight guard: blocks a second launch during the visibility-race window so
  // rapid double-clicks don't fire two window.location.assign + two fallback timers.
  const launchingRef = useRef(false);

  // Read fresh on each interaction (localStorage may change in another tab/window).
  const getSaved = useCallback(() => readLaunchPath(ideaId), [ideaId]);

  const defaultSlug = useMemo(() => slugifyIdeaTitle(ideaTitle), [ideaTitle]);

  // The launch state used when the user hasn't pinned one. No browser path needed:
  //  - idea has a GitHub repo → existing mode, empty path; the deep link's `repo`
  //    param makes Claude Code open (or clone) the repo locally.
  //  - no repo → a brand-new project under ~/projects/<slug>; the agent mkdir's it.
  const resolveState = useCallback((): LaunchPathState => {
    const saved = getSaved();
    if (saved) return saved;
    if (ideaGithubUrl) return { mode: "existing", path: "" };
    return {
      mode: "new",
      path: composeNewProjectPath(DEFAULT_NEW_PROJECT_PARENT, defaultSlug),
      parent: DEFAULT_NEW_PROJECT_PARENT,
      name: defaultSlug,
    };
  }, [getSaved, ideaGithubUrl, defaultSlug]);

  const buildPrompt = useCallback(
    (state: LaunchPathState): string => {
      const newProject =
        state.mode === "new" ? { newProjectPath: state.path } : undefined;
      if (props.variant === "board") {
        return buildBoardBootstrapPrompt({
          appUrl: APP_URL,
          ideaId,
          ideaTitle,
          mode: state.mode,
          repoUrl: ideaGithubUrl,
          newProject,
        });
      }
      return buildTaskBootstrapPrompt({
        appUrl: APP_URL,
        ideaId,
        taskId: props.taskId,
        taskTitle: props.taskTitle,
        mode: state.mode,
        repoUrl: ideaGithubUrl,
        newProject,
      });
    },
    [props, ideaId, ideaTitle, ideaGithubUrl]
  );

  // Compact variant for the DEEP LINK only — the claude-cli:// URL has an OS
  // length ceiling and an over-long URL silently fails to launch. The verbose
  // buildPrompt above stays on the copy-command path (a shell arg, no limit).
  const buildDeepLinkPrompt = useCallback(
    (state: LaunchPathState): string => {
      const newProject =
        state.mode === "new" ? { newProjectPath: state.path } : undefined;
      return buildCompactBootstrapPrompt({
        appUrl: APP_URL,
        ideaId,
        ideaTitle,
        mode: state.mode,
        repoUrl: ideaGithubUrl,
        newProject,
        taskId: props.variant === "board" ? undefined : props.taskId,
      });
    },
    [props, ideaId, ideaTitle, ideaGithubUrl]
  );

  const posthog = usePostHog();

  const copyCommand = useCallback(
    async (state: LaunchPathState) => {
      const prompt = buildPrompt(state);
      const cwd = state.mode === "new" ? undefined : state.path;
      const command = buildLaunchCommand({
        prompt,
        cwd,
        mode: state.mode,
        newProject: state.mode === "new" ? { newProjectPath: state.path } : undefined,
        repoUrl: ideaGithubUrl,
      });
      // Copying the command = the user fell back from the one-click deep link to
      // the terminal — a key signal of local-launch friction (desktop/mobile via
      // PostHog's $device_type).
      posthog?.capture("launch_command_copied", { mode: state.mode, has_repo: !!ideaGithubUrl });
      try {
        await navigator.clipboard.writeText(command);
        toast.success("Launch command copied — paste it in your terminal");
      } catch {
        toast.error("Couldn't copy the launch command");
      }
    },
    [buildPrompt, ideaGithubUrl, posthog]
  );

  const openInClaudeCode = useCallback(
    (state: LaunchPathState) => {
      // Ignore re-entry while a launch is mid-flight (double-click / Enter+click).
      if (launchingRef.current) return;
      launchingRef.current = true;
      posthog?.capture("launch_claude_code_clicked", {
        method: "deep_link",
        mode: state.mode,
        has_repo: !!ideaGithubUrl,
      });

      const prompt = buildDeepLinkPrompt(state);
      // cwd resolution:
      //  - existing mode with a user-pinned absolute path → use it.
      //  - new (no-repo) mode → use the effective target's cwd (the saved path or,
      //    falling back, the agent-recorded path for THIS machine). This is the
      //    SAME value the dropdown displays, so display and launch can't diverge.
      //    Otherwise none, and the bootstrap prompt's directory block creates
      //    ~/projects/<slug>. (`~`-paths don't expand in the cwd param.)
      //  - repo-backed → no cwd; the `repo` slug resolves the working copy
      //    (effectiveTarget.cwd is undefined for repo ideas).
      const cwd =
        state.mode === "existing" && state.path.trim()
          ? state.path.trim()
          : state.mode === "new"
            ? effectiveTarget.cwd
            : undefined;
      const link = buildClaudeDeepLink({
        prompt,
        cwd,
        repo: ideaGithubUrl ?? undefined,
      });

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

      try {
        window.location.assign(link);
      } catch {
        // Some browsers throw synchronously on a blocked custom scheme.
        cleanup();
        launchingRef.current = false;
        posthog?.capture("launch_claude_code_fallback", {
          reason: "blocked",
          mode: state.mode,
          has_repo: !!ideaGithubUrl,
        });
        toast.error("Your browser blocked the launch", {
          description: "Copy the command and run it in your terminal instead.",
          action: { label: "Copy command", onClick: () => void copyCommand(state) },
        });
        return;
      }

      function cleanup() {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("blur", markHandled);
        window.removeEventListener("pagehide", markHandled);
      }

      window.setTimeout(() => {
        cleanup();
        launchingRef.current = false;
        // A custom-scheme launch can't be reliably confirmed: when the browser
        // shows its native "Open Claude Code?" prompt the page fires no
        // blur/visibilitychange, so `handled` stays false even on success.
        // A lost document focus (app switch OR that native prompt) means it
        // almost certainly launched — treat it as handled. Otherwise show a
        // NEUTRAL nudge, not a red error, since it most likely opened anyway.
        if (handled || !document.hasFocus()) return;
        posthog?.capture("launch_claude_code_fallback", {
          reason: "no_confirm",
          mode: state.mode,
          has_repo: !!ideaGithubUrl,
        });
        toast("Opening Claude Code…", {
          description: "Didn't open? Copy the command and run it in your terminal.",
          action: { label: "Copy command", onClick: () => void copyCommand(state) },
        });
      }, SCHEME_RACE_MS);
    },
    [buildDeepLinkPrompt, ideaGithubUrl, effectiveTarget.cwd, copyCommand, posthog]
  );

  // Primary action: always launch. No path needed — repo-backed ideas resolve via
  // the `repo` param; repo-less ideas default to a new ~/projects/<slug> the agent creates.
  const handleLaunch = useCallback(() => {
    openInClaudeCode(resolveState());
  }, [resolveState, openInClaudeCode]);

  const handleCopy = useCallback(() => {
    void copyCommand(resolveState());
  }, [resolveState, copyCommand]);

  // The in-browser destination only exists behind the terminal flag. When the flag
  // is OFF this is false, so the menu collapses to exactly today's single
  // terminal-window action — the existing behaviour is completely untouched.
  // Picking "In the browser" asks the board's terminal dock (a page-level sibling)
  // to open + auto-launch via the vibecodes:// deep link; it does NOT also run the
  // terminal-window flow — Claude runs in one place at a time.
  const browserLaunchAvailable = isBrowserLaunchAvailable(isTerminalEnabled());
  const handleLaunchInBrowser = useCallback(() => {
    posthog?.capture("launch_claude_code_clicked", { method: "in_browser" });
    requestBrowserLaunch();
  }, [posthog]);

  const openDialog = useCallback((mode: LaunchMode, launch: boolean) => {
    setPendingLaunch(launch);
    setDialogMode(mode);
    setDialogOpen(true);
  }, []);

  const handleSaved = useCallback(
    (state: LaunchPathState) => {
      // Mirror the freshly-saved state so the dropdown's path line + launch cwd
      // update immediately (both read from effectiveTarget ← savedState).
      setSavedState(state);
      if (pendingLaunch) {
        setPendingLaunch(false);
        openInClaudeCode(state);
      }
    },
    [pendingLaunch, openInClaudeCode]
  );

  const dialog = (
    <LaunchPathDialog
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      ideaId={ideaId}
      ideaGithubUrl={ideaGithubUrl}
      initial={savedState}
      initialMode={dialogMode}
      launchOnSave={pendingLaunch}
      onSaved={handleSaved}
    />
  );

  // ── Per-task: card menu item ──────────────────────────────────────────────
  if (props.variant === "task-menu-item") {
    if (!isDesktop) {
      return (
        <DropdownMenuItem disabled className="py-2.5 text-muted-foreground sm:py-1.5">
          <Terminal className="mr-2 h-4 w-4" />
          Open on desktop to launch Claude Code
        </DropdownMenuItem>
      );
    }
    return (
      <>
        <DropdownMenuItem onSelect={handleLaunch} className="py-2.5 sm:py-1.5">
          <Terminal className="mr-2 h-4 w-4" />
          Launch in Claude Code
        </DropdownMenuItem>
        {dialog}
      </>
    );
  }

  // ── Per-task: detail header icon ──────────────────────────────────────────
  if (props.variant === "task-icon") {
    if (!isDesktop) return null;
    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={handleLaunch}
          aria-label="Launch in Claude Code"
          title="Launch in Claude Code"
        >
          <Terminal className="h-4 w-4" />
        </Button>
        {dialog}
      </>
    );
  }

  // ── Board toolbar: labelled split-button ──────────────────────────────────
  // Desktop-only — hidden below md (matches the existing action cluster recipe).
  if (!isDesktop) return null;

  return (
    <>
      <div className="hidden items-center md:inline-flex">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 rounded-r-none border border-emerald-500/25 bg-emerald-500/10 text-xs text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300"
          onClick={handleLaunch}
        >
          <Terminal className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Launch Claude Code</span>
        </Button>
        <DropdownMenu
          onOpenChange={(o) => {
            // Re-read localStorage on open so a save from another tab is reflected.
            if (o) refreshSaved();
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-7 rounded-l-none border border-l-0 border-emerald-500/25 bg-emerald-500/10 px-0 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300"
              aria-label="Launch options"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {browserLaunchAvailable ? (
              // Pick-one: where should Claude run? "In a terminal window" is today's
              // unchanged behaviour; "In the browser" opens the docked terminal.
              <>
                <DropdownMenuItem onSelect={handleLaunch}>
                  <Terminal className="mr-2 h-4 w-4" />
                  <div className="flex flex-col">
                    <span>In a terminal window</span>
                    <span className="text-[11px] text-muted-foreground">
                      On your computer — how it works today
                    </span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleLaunchInBrowser}>
                  <Globe className="mr-2 h-4 w-4" />
                  <div className="flex flex-col">
                    <span className="inline-flex items-center gap-1.5">
                      In the browser
                      <span className="rounded bg-sky-500/15 px-1 text-[10px] font-semibold uppercase leading-tight tracking-wide text-sky-400">
                        Beta
                      </span>
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      A live terminal docked on this board
                    </span>
                  </div>
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onSelect={handleLaunch}>
                <Terminal className="mr-2 h-4 w-4" />
                Open in Claude Code
              </DropdownMenuItem>
            )}
            {effectiveTarget.source !== "none" && effectiveTarget.displayPath && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground/80">
                    {effectiveTarget.displayLabel}
                  </div>
                  <code className="mt-0.5 block break-all font-mono text-[11px]">
                    {effectiveTarget.displayPath}
                  </code>
                </div>
              </>
            )}
            <DropdownMenuItem onSelect={() => openDialog("new", true)}>
              <FolderPlus className="mr-2 h-4 w-4" />
              Start a new project…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleCopy}>
              <Copy className="mr-2 h-4 w-4" />
              Copy launch command
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openDialog("existing", false)}>
              <FolderCog className="mr-2 h-4 w-4" />
              Set exact folder (advanced)…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={INSTALL_GUIDE_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Install guide
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {dialog}
    </>
  );
}
