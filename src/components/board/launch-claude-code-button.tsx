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
  chooseLaunchCwd,
  readLaunchPath,
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

  // Choose the cwd to inject into a no-repo launch (Design Review option (a):
  // exactly one recorded path → use it; 0 or >1 → undefined / first-launch flow).
  // Repo-backed ideas never use this — the `repo` slug resolves the folder.
  const recordedCwd = useMemo(
    () => (ideaGithubUrl ? undefined : chooseLaunchCwd(recordedProjectPaths)),
    [ideaGithubUrl, recordedProjectPaths]
  );
  // The single record (if any) backing recordedCwd — for the "This machine" line.
  const recordedHost = useMemo(() => {
    if (!recordedCwd) return undefined;
    return (recordedProjectPaths ?? []).find(
      (r) => r.absolute_path.trim() === recordedCwd
    );
  }, [recordedCwd, recordedProjectPaths]);

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
      //  - new (no-repo) mode → use the agent-recorded path for THIS machine if
      //    chooseLaunchCwd resolved one (exactly one record); otherwise none, and
      //    the bootstrap prompt's directory block creates ~/projects/<slug>. We
      //    never inject for new mode without a recorded absolute path (`~`-paths
      //    don't expand in the cwd param).
      //  - repo-backed → no cwd; the `repo` slug resolves the working copy
      //    (recordedCwd is forced undefined for repo ideas).
      const cwd =
        state.mode === "existing" && state.path.trim()
          ? state.path.trim()
          : state.mode === "new"
            ? recordedCwd
            : undefined;
      const link = buildClaudeDeepLink({
        prompt,
        cwd,
        repo: ideaGithubUrl ?? undefined,
      });

      let handled = false;
      const onVisibility = () => {
        if (document.visibilityState === "hidden") handled = true;
      };
      const onBlur = () => {
        handled = true;
      };
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("blur", onBlur);

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
        window.removeEventListener("blur", onBlur);
      }

      window.setTimeout(() => {
        cleanup();
        launchingRef.current = false;
        if (handled) return;
        // Detection is heuristic — Claude Code may have opened anyway — so keep
        // this soft and always offer the manual fallback.
        toast.error("Couldn't confirm Claude Code opened", {
          description: "If nothing happened, copy the command and run it in your terminal.",
          action: { label: "Copy command", onClick: () => void copyCommand(state) },
        });
      }, SCHEME_RACE_MS);
    },
    [buildPrompt, ideaGithubUrl, recordedCwd, copyCommand]
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
      initial={readLaunchPath(ideaId)}
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
        <DropdownMenu>
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
            {recordedHost && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground/80">
                    This machine — {recordedHost.hostname}
                  </div>
                  <code className="mt-0.5 block break-all font-mono text-[11px]">
                    {recordedHost.absolute_path}
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
