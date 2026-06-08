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
import { logger } from "@/lib/logger";
import {
  type LaunchMode,
  type LaunchPathState,
  buildClaudeDeepLink,
  buildLaunchCommand,
  buildBoardBootstrapPrompt,
  buildTaskBootstrapPrompt,
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
  const { ideaId, ideaTitle, ideaGithubUrl } = props;
  const isDesktop = useMediaQuery("(min-width: 768px)");

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
      // cwd is ONLY passed for existing mode with a real absolute path the user
      // pinned. New mode: the agent mkdir's the dir (it may not exist yet, and
      // `~`-relative paths don't expand in the cwd param). Repo default: empty
      // path → no cwd → the `repo` param resolves the working copy.
      const cwd =
        state.mode === "existing" && state.path.trim() ? state.path.trim() : undefined;
      const link = buildClaudeDeepLink({
        prompt,
        cwd,
        repo: ideaGithubUrl ?? undefined,
      });

      // Diagnostic (temporary): logged at warn so it survives the prod log level.
      // Captures the EXACT URL + lengths so we can reproduce a failing launch.
      logger.warn("launch-claude-code: opening deep link", {
        mode: state.mode,
        cwd: cwd ?? null,
        repo: ideaGithubUrl ?? null,
        promptChars: prompt.length,
        encodedQChars: encodeURIComponent(prompt).length,
        urlChars: link.length,
        url: link,
      });

      const copyLink = () => {
        navigator.clipboard.writeText(link).then(
          () => toast.success("Launch link copied — paste it here for debugging"),
          () => toast.error("Couldn't copy the link")
        );
      };

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
          description: "Copy the launch link and share it for debugging.",
          action: { label: "Copy launch link", onClick: copyLink },
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
        // Nothing visibly handled the scheme. (Detection is heuristic — it may
        // have opened anyway.) Offer the exact link so we can reproduce.
        toast.error("Couldn't confirm Claude Code opened", {
          description: "If nothing happened, copy the launch link and share it for debugging.",
          action: { label: "Copy launch link", onClick: copyLink },
        });
      }, SCHEME_RACE_MS);
    },
    [buildPrompt, ideaGithubUrl]
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
