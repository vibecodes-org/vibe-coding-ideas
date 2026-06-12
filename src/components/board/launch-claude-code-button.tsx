"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Terminal, ChevronDown, Copy, FolderCog, FolderPlus, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  type LaunchMode,
  type LaunchPathState,
  type RecordedProjectPath,
  buildClaudeDeepLink,
  buildLaunchCommand,
  buildBoardBootstrapPrompt,
  buildTaskBootstrapPrompt,
  readLaunchPath,
  resolveEffectiveLaunchTarget,
  slugifyIdeaTitle,
  composeNewProjectPath,
  DEFAULT_NEW_PROJECT_PARENT,
} from "@/lib/launch-claude-code";
import { LaunchPathDialog } from "./launch-path-dialog";

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
      try {
        await navigator.clipboard.writeText(command);
        toast.success("Launch command copied — paste it in your terminal");
      } catch {
        toast.error("Couldn't copy the launch command");
      }
    },
    [buildPrompt, ideaGithubUrl]
  );

  const openInClaudeCode = useCallback(
    (state: LaunchPathState) => {
      // Ignore re-entry while a launch is mid-flight (double-click / Enter+click).
      if (launchingRef.current) return;
      launchingRef.current = true;

      const prompt = buildPrompt(state);
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
        toast("Opening Claude Code…", {
          description: "Didn't open? Copy the command and run it in your terminal.",
          action: { label: "Copy command", onClick: () => void copyCommand(state) },
        });
      }, SCHEME_RACE_MS);
    },
    [buildPrompt, ideaGithubUrl, effectiveTarget.cwd, copyCommand]
  );

  // Primary action: always launch. No path needed — repo-backed ideas resolve via
  // the `repo` param; repo-less ideas default to a new ~/projects/<slug> the agent creates.
  const handleLaunch = useCallback(() => {
    openInClaudeCode(resolveState());
  }, [resolveState, openInClaudeCode]);

  const handleCopy = useCallback(() => {
    void copyCommand(resolveState());
  }, [resolveState, copyCommand]);

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
            <DropdownMenuItem onSelect={handleLaunch}>
              <Terminal className="mr-2 h-4 w-4" />
              Open in Claude Code
            </DropdownMenuItem>
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
