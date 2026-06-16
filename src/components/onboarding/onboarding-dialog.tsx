"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Sparkles,
  ArrowRight,
  ChevronLeft,
  Check,
  Lightbulb,
  LayoutDashboard,
  Bot,
  Copy,
  Monitor,
  Rocket,
  Terminal,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StepIndicator } from "./step-indicator";
import { TOTAL_STEPS, indicatorIndex } from "./onboarding-steps";
import { Confetti } from "./confetti";
import { ProjectTypeSelector } from "@/components/kits/project-type-selector";
import { KitPreview } from "@/components/kits/kit-preview";
import { CreateEnhanceDialog } from "@/components/ideas/create-enhance-dialog";
import { VisibilitySelector } from "@/components/ideas/visibility-selector";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useLaunchClaudeCode } from "@/lib/use-launch-claude-code";
import { MCP_COMMAND, MCP_GUIDE_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  completeOnboarding,
  createIdeaFromOnboarding,
  updateProfileFromOnboarding,
  generateBoardFromOnboarding,
} from "@/actions/onboarding";
import type { KitWithSteps } from "@/actions/kits";
import type { OnboardingGeneratedTask } from "@/actions/onboarding";

interface SimpleBotProfile {
  id: string;
  full_name: string | null;
  role: string | null;
  system_prompt: string | null;
  is_active: boolean;
}

interface OnboardingDialogProps {
  open: boolean;
  onComplete: () => void;
  userFullName: string | null;
  userAvatarUrl: string | null;
  userGithubUsername: string | null;
  kits: KitWithSteps[];
  canUseAi: boolean;
  hasByokKey: boolean;
  starterCredits: number;
  bots: SimpleBotProfile[];
}

export function OnboardingDialog({
  open,
  onComplete,
  userFullName,
  userAvatarUrl,
  userGithubUsername,
  kits,
  canUseAi,
  hasByokKey,
  starterCredits,
  bots,
}: OnboardingDialogProps) {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Profile fields
  const [displayName, setDisplayName] = useState(userFullName ?? "");
  const [bio, setBio] = useState("");
  const [githubUsername, setGithubUsername] = useState(
    userGithubUsername ?? ""
  );

  // Project fields (Step 2)
  const [ideaTitle, setIdeaTitle] = useState("");
  const [ideaDescription, setIdeaDescription] = useState("");
  // Pre-select the Web kit so onboarding matches the New Idea form (commit
  // 000d8e9) — users land with a ready kit instead of nothing. Match by name,
  // fall back to the first non-Custom kit by display order.
  const [selectedKitId, setSelectedKitId] = useState<string | null>(() => {
    if (!kits?.length) return null;
    const web = kits.find((k) => k.name.toLowerCase() === "web application");
    if (web) return web.id;
    return (
      [...kits]
        .filter((k) => k.name !== "Custom")
        .sort((a, b) => a.display_order - b.display_order)[0]?.id ?? null
    );
  });
  const [visibility, setVisibility] = useState<"public" | "private">("public");

  // AI Enhance (preview dialog — shared with the New Idea flow)
  const [enhanceDialogOpen, setEnhanceDialogOpen] = useState(false);
  const [descriptionEnhanced, setDescriptionEnhanced] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState(starterCredits);

  // Creation state (Step 2 loading → Step 3)
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState(0); // 0=idle, 1=idea, 2=kit, 3=generating
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [createdIdeaId, setCreatedIdeaId] = useState<string | null>(null);
  const [agentCount, setAgentCount] = useState(0);
  const [workflowApplied, setWorkflowApplied] = useState(false);
  const [autoRuleCreated, setAutoRuleCreated] = useState(false);
  const [generatedTasks, setGeneratedTasks] = useState<OnboardingGeneratedTask[]>([]);
  const [generationFailed, setGenerationFailed] = useState(false);

  // MCP (Step 4)
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  // Manual `claude mcp add` setup is demoted to a collapsed disclosure below the
  // primary "Launch Claude Code" action on desktop.
  const [manualOpen, setManualOpen] = useState(false);
  const isMobile = useMediaQuery("(max-width: 640px)");
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // Launch deep link built from the just-created idea (auto-connects MCP +
  // picks up the board). Desktop-only — gated below. Stable when no idea yet.
  const { launch: launchClaudeCode, copyCommand: copyLaunchCommand } =
    useLaunchClaudeCode({
      ideaId: createdIdeaId ?? "",
      ideaTitle: ideaTitle || "your project",
    });

  const avatarInitial = displayName.charAt(0).toUpperCase() || "?";
  const selectedKit = kits.find((k) => k.id === selectedKitId) ?? null;
  const isCustomKit = selectedKit?.name === "Custom";

  const goToStep = useCallback((s: number) => {
    setStep(s);
  }, []);

  // Elapsed timer during creation (ticks every second while creating)
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);
  useEffect(() => {
    if (creating) {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [creating]);

  const handleSkip = async () => {
    try {
      await completeOnboarding();
    } catch {
      // Non-critical
    }
    onComplete();
  };

  const handleSkipToBoard = async () => {
    try {
      await completeOnboarding();
    } catch {
      // Non-critical
    }
    if (createdIdeaId) {
      window.location.href = `/ideas/${createdIdeaId}/board`;
    } else {
      onComplete();
    }
  };

  const handleOpenEnhance = useCallback(() => {
    if (!ideaTitle.trim()) {
      toast.error("Add a project name first so AI knows what to enhance");
      return;
    }
    setEnhanceDialogOpen(true);
  }, [ideaTitle]);

  const handleApplyEnhanced = useCallback(
    (text: string) => {
      setIdeaDescription(text);
      setDescriptionEnhanced(true);
      if (!hasByokKey) setCreditsRemaining((prev) => Math.max(0, prev - 1));
    },
    [hasByokKey]
  );

  const handleProfileContinue = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await updateProfileFromOnboarding({
        full_name: displayName || undefined,
        bio: bio || undefined,
        github_username: githubUsername || undefined,
      });
      goToStep(2);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update profile"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateAndGenerate = async () => {
    if (creating) return;
    if (!ideaTitle.trim()) {
      toast.error("Give your project a name");
      return;
    }
    setCreating(true);
    setCreateProgress(1);

    try {
      // Step 1: Create idea + apply kit
      const result = await createIdeaFromOnboarding({
        title: ideaTitle,
        description: ideaDescription || undefined,
        kitId: selectedKitId ?? undefined,
        visibility,
      });

      setCreatedIdeaId(result.ideaId);
      if (result.kitResult) {
        setAgentCount(result.kitResult.agentsCreated + result.kitResult.agentsSkipped);
        setWorkflowApplied(result.kitResult.templateImported);
        setAutoRuleCreated(result.kitResult.autoRuleCreated);
      }
      setCreateProgress(2);

      // Step 2: Generate board tasks (free)
      setCreateProgress(3);
      try {
        const { tasks } = await generateBoardFromOnboarding(result.ideaId);
        setGeneratedTasks(tasks);
      } catch (err) {
        setGenerationFailed(true);
        toast.error(
          err instanceof Error ? err.message : "Board task generation failed — you can generate tasks from your board later"
        );
      }
      setCreateProgress(4);

      // Brief pause so user sees completion before transition
      await new Promise((r) => setTimeout(r, 400));
      goToStep(3);
    } catch (err) {
      if (err instanceof Error && "digest" in err) {
        const digest = (err as { digest?: string }).digest;
        if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
          throw err;
        }
      }
      toast.error(
        err instanceof Error ? err.message : "Failed to create project"
      );
    } finally {
      setCreating(false);
      setCreateProgress(0);
    }
  };

  const handleFinishToBoard = async () => {
    try {
      await completeOnboarding();
    } catch {
      // Non-critical
    }
    if (createdIdeaId) {
      window.location.href = `/ideas/${createdIdeaId}/board`;
    } else {
      onComplete();
    }
  };

  const handleFinishToDashboard = async () => {
    try {
      await completeOnboarding();
    } catch {
      // Non-critical
    }
    onComplete();
  };

  const copyMcpCommand = async () => {
    try {
      await navigator.clipboard.writeText(MCP_COMMAND);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const copyMcpGuideLink = async () => {
    try {
      const url = `${window.location.origin}${MCP_GUIDE_URL}`;
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      toast.success("Setup link copied — paste it on your computer");
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast.error("Failed to copy — please copy manually");
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[95vh] gap-0 overflow-x-hidden overflow-y-auto [&::-webkit-scrollbar]:hidden rounded-2xl border-border/50 p-0 sm:max-w-[580px]"
        style={{ scrollbarWidth: "none" }}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Welcome to VibeCodes</DialogTitle>

        {/* Ambient glow */}
        <div className="pointer-events-none absolute top-0 right-0 left-0 z-0">
          <div className="mx-auto h-px w-64 bg-gradient-to-r from-transparent via-primary to-transparent" />
          <div className="mx-auto h-20 w-72 bg-primary/[0.08] blur-3xl" />
        </div>

        <StepIndicator
          totalSteps={TOTAL_STEPS}
          currentStep={indicatorIndex(step)}
        />

        <div
          key={step}
          className="animate-in fade-in-0 duration-300 relative z-[1] min-w-0"
        >
          {/* ── STEP 0: WELCOME ── */}
          {step === 0 && (
            <div className="px-8 pt-6 pb-8 sm:px-10">
              <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/[0.08] px-3.5 py-1 text-xs font-semibold text-primary">
                <Sparkles
                  className="h-3.5 w-3.5 animate-spin"
                  style={{ animationDuration: "4s" }}
                />
                Getting started
              </div>
              <h2 className="-tracking-wide mb-2 text-2xl font-bold text-foreground sm:text-[28px]">
                Welcome to VibeCodes!
              </h2>
              <p className="mb-7 text-[15px] text-muted-foreground">
                Your AI agents become real team members. Describe what you want
                to build, and we&apos;ll set up your board, workflows, and
                agents automatically.
              </p>

              <div className="mb-8 flex flex-col gap-2.5">
                {[
                  {
                    icon: Lightbulb,
                    color: "text-amber-400",
                    bg: "bg-amber-400/10",
                    title: "Describe your idea",
                    desc: "AI refines your vision",
                  },
                  {
                    icon: LayoutDashboard,
                    color: "text-blue-400",
                    bg: "bg-blue-400/10",
                    title: "Get a ready-made board",
                    desc: "Tasks, workflows, agents",
                  },
                  {
                    icon: Bot,
                    color: "text-emerald-400",
                    bg: "bg-emerald-400/10",
                    title: "Agents do the work",
                    desc: "Via Claude Code + MCP (Model Context Protocol)",
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="flex items-center gap-3.5 rounded-xl border border-border/60 bg-card/60 p-3.5 transition-colors hover:border-border hover:bg-card/80"
                  >
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${item.bg}`}
                    >
                      <item.icon
                        className={`h-[18px] w-[18px] ${item.color}`}
                      />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {item.title}
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <Button
                className="w-full gap-2"
                size="lg"
                onClick={() => goToStep(1)}
              >
                Let&apos;s get started
                <ArrowRight className="h-4 w-4" />
              </Button>
              <button
                onClick={handleSkip}
                className="mt-3 block w-full text-center text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Skip for now
              </button>
            </div>
          )}

          {/* ── STEP 1: PROFILE ── */}
          {step === 1 && (
            <div className="px-8 pt-4 pb-8 sm:px-10">
              <div className="mb-4 flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => goToStep(0)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground">
                  Step 2 of {TOTAL_STEPS}
                </span>
              </div>

              <h2 className="-tracking-wide mb-1 text-xl font-bold text-foreground sm:text-[22px]">
                Quick profile setup
              </h2>
              <p className="mb-6 text-sm text-muted-foreground">
                Optional — help others know who you are, or skip and do it later.
              </p>

              <div className="mb-5 flex items-center gap-3.5">
                {userAvatarUrl ? (
                  <img
                    src={userAvatarUrl}
                    alt="Avatar"
                    className="h-[52px] w-[52px] shrink-0 rounded-full"
                  />
                ) : (
                  <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-violet-400 text-xl font-bold text-white">
                    {avatarInitial}
                  </div>
                )}
                <div className="text-[13px] leading-relaxed text-muted-foreground">
                  {userAvatarUrl ? (
                    <>
                      <span className="font-medium text-foreground">
                        Looking good!
                      </span>
                      <br />
                      Your avatar was imported from your account.
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-foreground">
                        No avatar yet
                      </span>
                      <br />
                      You can add one later in your profile settings.
                    </>
                  )}
                </div>
              </div>

              <div className="mb-4">
                <label className="mb-1.5 block text-[13px] font-medium text-foreground">
                  Display name
                </label>
                <Input
                  placeholder="Your name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="mb-4">
                <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                  Bio
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                    optional
                  </span>
                </label>
                <Input
                  placeholder="e.g., Full-stack dev, AI enthusiast"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                />
              </div>

              <div className="mb-6">
                <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                  GitHub
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                    optional
                  </span>
                </label>
                <Input
                  placeholder="username"
                  value={githubUsername}
                  onChange={(e) => setGithubUsername(e.target.value)}
                />
              </div>

              <Button
                className="w-full gap-2"
                size="lg"
                onClick={handleProfileContinue}
                disabled={submitting}
              >
                {submitting ? "Saving..." : "Continue"}
                {!submitting && <ArrowRight className="h-4 w-4" />}
              </Button>
              <button
                onClick={() => goToStep(2)}
                className="mt-3 block w-full text-center text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Skip this step
              </button>
            </div>
          )}

          {/* ── STEP 2: YOUR PROJECT ── */}
          {step === 2 && !creating && (
            <div className="px-8 pt-3 pb-6 sm:px-10">
              <div className="mb-3 flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => goToStep(1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground">
                  Step 3 of {TOTAL_STEPS}
                </span>
              </div>

              <h2 className="-tracking-wide mb-1 text-lg font-bold text-foreground sm:text-xl">
                What are you building?
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">
                Name it, pick a starting point, and we&apos;ll set up your board,
                agents, and workflows.
              </p>

              {/* 1 · Project name */}
              <div className="mb-3">
                <label className="mb-1.5 block text-[13px] font-medium text-foreground">
                  Project name
                </label>
                <Input
                  placeholder="e.g. Recipe-sharing app with AI meal suggestions"
                  value={ideaTitle}
                  onChange={(e) => setIdeaTitle(e.target.value)}
                  autoFocus
                />
              </div>

              {/* 2 · Project type (kit) — above description so it feeds AI context */}
              {kits.length > 0 && (
                <div className="mb-3">
                  <label className="mb-1.5 block text-[13px] font-medium text-foreground">
                    What kind of project?
                  </label>
                  <ProjectTypeSelector
                    kits={kits}
                    selectedKitId={selectedKitId}
                    onSelect={setSelectedKitId}
                    compact
                  />
                  {selectedKit && (
                    <KitPreview kit={selectedKit} />
                  )}
                </div>
              )}

              {/* 3 · Description (optional) with enhance affordance in toolbar */}
              <div className="mb-3">
                <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                  Description
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                    optional
                  </span>
                  {descriptionEnhanced && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-500">
                      <Check className="h-2.5 w-2.5" />
                      AI enhanced
                    </span>
                  )}
                </label>
                <div
                  className={cn(
                    "overflow-hidden rounded-md border transition-colors focus-within:border-violet-500",
                    descriptionEnhanced
                      ? "border-violet-500/25 bg-violet-500/[0.03]"
                      : "border-border"
                  )}
                >
                  <Textarea
                    placeholder="A few rough notes are plenty — AI can flesh it out for you below."
                    value={ideaDescription}
                    onChange={(e) => {
                      setIdeaDescription(e.target.value);
                      if (descriptionEnhanced) setDescriptionEnhanced(false);
                    }}
                    rows={3}
                    className="max-h-32 overflow-y-auto rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <div className="flex items-center justify-between border-t border-border bg-muted/20 px-3 py-1.5">
                    <span className="text-[11px] text-muted-foreground/60">
                      Supports markdown
                    </span>
                    {canUseAi && (
                      <button
                        type="button"
                        onClick={handleOpenEnhance}
                        title="Preview an AI-polished description before applying it"
                        className="group inline-flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-gradient-to-r from-violet-500/[0.12] to-purple-500/[0.06] px-2.5 py-1 text-[13px] font-semibold text-violet-400 transition-all hover:border-violet-500/50 hover:from-violet-500/[0.2] hover:to-purple-500/[0.12]"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {descriptionEnhanced
                          ? "Refine"
                          : ideaDescription.trim().length < 80
                            ? "Draft with AI"
                            : "Expand with AI"}
                        {!hasByokKey && creditsRemaining > 0 && (
                          <span className="flex h-[1.1rem] w-[1.1rem] items-center justify-center rounded-full bg-violet-600 text-[0.6rem] font-bold leading-none text-white">
                            {creditsRemaining}
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* 4 · Visibility (shared segmented control) */}
              <div className="mb-4">
                <label className="mb-1.5 block text-[13px] font-medium text-foreground">
                  Visibility
                </label>
                <VisibilitySelector
                  value={visibility}
                  onChange={setVisibility}
                  idPrefix="onboarding-visibility"
                />
              </div>

              <Button
                className="w-full gap-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:brightness-110"
                size="lg"
                onClick={handleCreateAndGenerate}
                disabled={creating}
              >
                <Sparkles className="h-4 w-4" />
                Create &amp; generate board
                <ArrowRight className="h-4 w-4" />
              </Button>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                Creates the idea, applies the kit&apos;s agents &amp; workflow,
                and auto-generates an AI task board.
              </p>
              <button
                onClick={handleSkip}
                className="mt-2 block w-full text-center text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              >
                I&apos;ll do this later
              </button>
            </div>
          )}

          {/* ── STEP 2: LOADING STATE ── */}
          {step === 2 && creating && (
            <div className="px-8 pt-8 pb-10 sm:px-10 text-center">
              <div
                className="text-[2rem] mb-3"
                style={{ animation: "pulse 2s ease-in-out infinite" }}
              >
                🚀
              </div>
              <h2 className="-tracking-wide mb-1 text-xl font-bold text-foreground">
                Creating your project...
              </h2>
              <p className="mb-5 text-sm text-muted-foreground max-w-[350px] mx-auto">
                This can take up to a minute — generating your board, agents, and
                workflows.
                {elapsedSeconds > 0 && (
                  <span className="block mt-1 text-xs tabular-nums">
                    {elapsedSeconds}s elapsed — hang tight, this runs in the
                    background.
                  </span>
                )}
              </p>

              {/* Progress bar — during step 3 (AI generation), slowly creep from 55% to 90% over ~60s */}
              <div className="h-1 w-full rounded-full bg-muted overflow-hidden mb-5">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-1000"
                  style={{
                    width:
                      createProgress >= 4
                        ? "100%"
                        : createProgress === 3
                          ? `${Math.min(55 + elapsedSeconds * 0.6, 92)}%`
                          : createProgress === 2
                            ? "55%"
                            : createProgress === 1
                              ? "20%"
                              : "0%",
                  }}
                />
              </div>

              <div className="flex flex-col gap-2 max-w-[260px] mx-auto text-left">
                <div className="flex items-center gap-2.5 text-[13px]">
                  {createProgress >= 2 ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0 flex items-center justify-center">
                      <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                    </span>
                  )}
                  <span
                    className={
                      createProgress >= 2
                        ? "text-muted-foreground"
                        : "text-foreground"
                    }
                  >
                    Created idea
                  </span>
                </div>
                <div className="flex items-center gap-2.5 text-[13px]">
                  {createProgress >= 3 ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  ) : createProgress === 2 ? (
                    <span className="h-3.5 w-3.5 shrink-0 flex items-center justify-center">
                      <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                    </span>
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span
                    className={
                      createProgress >= 3
                        ? "text-muted-foreground"
                        : createProgress === 2
                          ? "text-foreground"
                          : "text-muted-foreground/50"
                    }
                  >
                    {selectedKit
                      ? `Applied ${selectedKit.name} kit`
                      : "Setting up board"}
                  </span>
                </div>
                <div className="flex items-center gap-2.5 text-[13px]">
                  {createProgress > 3 && !generationFailed ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  ) : createProgress > 3 && generationFailed ? (
                    <X className="h-3.5 w-3.5 text-red-400 shrink-0" />
                  ) : createProgress === 3 ? (
                    <span className="h-3.5 w-3.5 shrink-0 flex items-center justify-center">
                      <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                    </span>
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span
                    className={
                      createProgress > 3 && generationFailed
                        ? "text-red-400"
                        : createProgress === 3
                          ? "text-foreground"
                          : "text-muted-foreground/50"
                    }
                  >
                    {createProgress > 3 && generationFailed
                      ? "Board tasks skipped — generate from your board later"
                      : "Generating board tasks..."}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 3: YOUR BOARD ── */}
          {step === 3 && (
            <div className="px-8 pt-5 pb-8 sm:px-10">
              <div className="mb-1 flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15">
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                </div>
                <h2 className="-tracking-wide text-xl font-bold text-foreground sm:text-[22px]">
                  Your board is ready!
                </h2>
              </div>

              {!generationFailed && generatedTasks.length > 0 ? (
                <>
                  <p className="mb-4 text-sm text-muted-foreground">
                    AI generated {generatedTasks.length} tasks
                    {selectedKit ? ` with the ${selectedKit.name} workflow` : ""}.
                    Your agents are allocated and ready to work.
                  </p>

                  {/* Mini board preview */}
                  <div className="grid grid-cols-3 gap-2 mb-3 max-sm:grid-cols-1">
                    {["Backlog", "To Do", "In Progress"].map((col) => {
                      const colTasks = generatedTasks.filter(
                        (t) => (t.columnName ?? "To Do") === col
                      );
                      return (
                        <div
                          key={col}
                          className="rounded-lg border border-border bg-card/60 p-2"
                        >
                          <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold text-muted-foreground">
                            {col}
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[9px]">
                              {colTasks.length}
                            </span>
                          </div>
                          {colTasks.slice(0, 2).map((task, i) => (
                            <div
                              key={i}
                              className="mb-1.5 rounded border border-border bg-background p-1.5 text-[11px] text-muted-foreground"
                            >
                              {task.labels?.[0] && (
                                <span className="mb-0.5 inline-block rounded bg-violet-500/[0.12] px-1 py-0.5 text-[9px] font-bold text-violet-400">
                                  {task.labels[0]}
                                </span>
                              )}
                              <div className="truncate">{task.title}</div>
                            </div>
                          ))}
                          {colTasks.length > 2 && (
                            <p className="text-[10px] text-muted-foreground/60 italic">
                              +{colTasks.length - 2} more
                            </p>
                          )}
                          {colTasks.length === 0 && (
                            <p className="py-2 text-center text-[10px] text-muted-foreground/40">
                              Your agents will pick up tasks here
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="mb-4 text-sm text-muted-foreground">
                  Your idea is created. Go to your board to generate tasks with AI.
                </p>
              )}

              {/* Confirmation badges */}
              <div className="flex flex-wrap gap-2 mb-4">
                {agentCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/[0.12] border border-emerald-500/25 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                    <Check className="h-3 w-3" />
                    {agentCount} agent{agentCount !== 1 ? "s" : ""} allocated
                  </span>
                )}
                {workflowApplied && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-violet-500/[0.12] border border-violet-500/25 px-2.5 py-1 text-xs font-semibold text-violet-400">
                    <Check className="h-3 w-3" />
                    {selectedKit ? `${selectedKit.name} workflow` : "Workflow"} applied
                  </span>
                )}
                {autoRuleCreated && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/[0.12] border border-amber-500/25 px-2.5 py-1 text-xs font-semibold text-amber-400">
                    <Check className="h-3 w-3" />
                    Workflow triggers active
                  </span>
                )}
              </div>

              <Button
                className="w-full gap-2"
                size="lg"
                onClick={() => goToStep(4)}
              >
                Next: Connect Claude Code
                <ArrowRight className="h-4 w-4" />
              </Button>
              <button
                onClick={handleSkipToBoard}
                className="mt-3 block w-full text-center text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              >
                I&apos;ll do this later
              </button>
            </div>
          )}

          {/* ── STEP 4: CONNECT MCP ── */}
          {step === 4 && (
            <div className="px-8 pt-4 pb-8 sm:px-10">
              <div className="mb-3 flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => goToStep(3)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground">
                  Step 4 of {TOTAL_STEPS}
                </span>
              </div>

              <h2 className="-tracking-wide mb-1 text-xl font-bold text-foreground sm:text-[22px]">
                Connect Claude Code
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">
                This is how your AI agents come to life. Claude Code reads your
                board, claims tasks, and executes workflow steps as each agent
                persona.
              </p>

              {/* Mobile off-ramp — a phone has no terminal */}
              {isMobile && (
                <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-cyan-500/25 bg-cyan-500/[0.06] p-3">
                  <Monitor className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">
                      You&apos;ll need a computer for this step
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Claude Code runs in a terminal. Open the{" "}
                      <Link
                        href={MCP_GUIDE_URL}
                        className="font-medium text-cyan-400 hover:text-cyan-300"
                      >
                        setup guide
                      </Link>{" "}
                      on your dev machine to continue — or skip and connect later.
                    </p>
                    <button
                      onClick={copyMcpGuideLink}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-card/80"
                    >
                      {copiedLink ? (
                        <Check className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      {copiedLink ? "Copied!" : "Copy setup link"}
                    </button>
                  </div>
                </div>
              )}

              {/* Why this matters callout */}
              <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3.5">
                <p className="mb-1 text-[13px] font-bold text-amber-400">
                  ⚡ Why this matters
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Without this connection, your agents can&apos;t work. MCP
                  (Model Context Protocol) lets Claude Code read your board,
                  claim tasks, and complete workflow steps as each agent persona.
                </p>
              </div>

              {/* PRIMARY: Launch Claude Code (desktop only — opens the local app,
                  auto-connects MCP, and picks up this idea's board). */}
              {isDesktop && (
                <div className="mb-4">
                  <Button
                    className="w-full gap-2 bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
                    size="lg"
                    onClick={launchClaudeCode}
                    disabled={!createdIdeaId}
                  >
                    <Rocket className="h-4 w-4" />
                    Launch Claude Code
                  </Button>
                  <p className="mt-2 text-center text-[11px] text-muted-foreground">
                    Opens Claude Code on this computer, connects VibeCodes, and
                    starts on your board. Review the prompt, then press Enter.
                  </p>
                  {!createdIdeaId && (
                    <p className="mt-1 text-center text-[11px] text-amber-400/80">
                      Create your project first to enable Launch.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void copyLaunchCommand()}
                    disabled={!createdIdeaId}
                    className="mx-auto mt-2 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    <Copy className="h-3 w-3" />
                    Or copy the launch command
                  </button>
                </div>
              )}

              {/* FALLBACK: manual `claude mcp add` for users without Claude Code
                  set up, or who prefer the manual path. Collapsed by default. */}
              <div className="mb-4 rounded-xl border border-border bg-card/40">
                <button
                  type="button"
                  onClick={() => setManualOpen((o) => !o)}
                  aria-expanded={manualOpen}
                  className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left"
                >
                  <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                    <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                    No Claude Code yet? Manual setup
                  </span>
                  <ChevronLeft
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      manualOpen ? "-rotate-90" : "rotate-0"
                    )}
                    aria-hidden="true"
                  />
                </button>
                {manualOpen && (
                  <div className="border-t border-border px-3.5 pt-3 pb-3.5">
                    <p className="mb-2 text-[11px] text-muted-foreground">
                      Run this once in your terminal — it connects VibeCodes for
                      all your projects.
                    </p>
                    {/* Terminal block */}
                    <div className="mb-3 rounded-lg border border-border bg-[#0a0a0a] p-3 font-mono text-[12px] leading-relaxed">
                      <div className="break-all">
                        <span className="text-emerald-400">$</span>{" "}
                        <span className="text-foreground">
                          claude mcp add -s user --transport http vibecodes-remote{" "}
                          <span className="text-amber-400">
                            https://vibecodes.co.uk/api/mcp
                          </span>
                        </span>
                      </div>
                      <div className="text-muted-foreground/60">
                        → Connecting to VibeCodes MCP server...
                      </div>
                      <div className="text-emerald-400">
                        ✓ Connected as{" "}
                        <span className="font-bold text-violet-400">
                          {displayName || "You"}
                        </span>
                      </div>
                      {createdIdeaId && (
                        <div className="text-emerald-400">
                          ✓ Board:{" "}
                          <span className="font-bold text-violet-400">
                            {ideaTitle}
                          </span>{" "}
                          ({generatedTasks.length} tasks
                          {agentCount > 0 ? `, ${agentCount} agents` : ""})
                        </div>
                      )}
                    </div>
                    <button
                      onClick={copyMcpCommand}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition-all",
                        copied
                          ? "border-emerald-500/50 text-emerald-400"
                          : "border-border bg-card text-foreground hover:bg-card/80"
                      )}
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copied ? "Copied!" : "Copy command"}
                    </button>
                  </div>
                )}
              </div>

              {/* Fallback */}
              <div className="mb-4 border-t border-border pt-3">
                <p className="mb-1 text-[13px] font-semibold text-muted-foreground">
                  Don&apos;t use Claude Code?
                </p>
                <p className="text-xs text-muted-foreground/60">
                  You can still manage your board manually and use workflows
                  from the web UI. But for the full agent-powered experience,
                  Claude Code + MCP is the way to go.{" "}
                  <a
                    href="/guide/mcp-integration"
                    className="text-primary hover:underline"
                  >
                    Learn more →
                  </a>
                </p>
              </div>

              <Button
                className="w-full gap-2"
                size="lg"
                onClick={() => goToStep(5)}
              >
                I&apos;ve connected — let&apos;s go!
                <ArrowRight className="h-4 w-4" />
              </Button>
              <button
                onClick={handleSkipToBoard}
                className="mt-3 block w-full text-center text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              >
                I&apos;ll do this later
              </button>
            </div>
          )}

          {/* ── STEP 5: YOU'RE LIVE ── */}
          {step === 5 && (
            <div className="overflow-hidden px-6 pt-8 pb-8 sm:px-10">
              <Confetti />

              <div className="text-center">
                <div className="mb-3 text-[2.5rem]">🎉</div>
                <h2 className="-tracking-wide mb-1 text-xl font-bold text-foreground sm:text-[22px]">
                  You&apos;re all set!
                </h2>
                <p className="mb-5 text-sm text-muted-foreground max-w-[380px] mx-auto">
                  {createdIdeaId
                    ? "Your project is configured and your agents are ready. Here's what you have:"
                    : "You're all set! Head to the dashboard to create your first project."}
                </p>

                {createdIdeaId && (
                  <div className="mb-6 flex justify-center gap-3 flex-wrap">
                    <div className="rounded-xl border border-border bg-card/60 px-5 py-3 text-center min-w-[100px]">
                      <div className="text-2xl font-extrabold text-violet-400">
                        {generatedTasks.length}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Board tasks
                      </div>
                    </div>
                    <div className="rounded-xl border border-border bg-card/60 px-5 py-3 text-center min-w-[100px]">
                      <div className="text-2xl font-extrabold text-emerald-400">
                        {agentCount}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        AI agents
                      </div>
                    </div>
                    <div className="rounded-xl border border-border bg-card/60 px-5 py-3 text-center min-w-[100px]">
                      <div className="text-2xl font-extrabold text-amber-400">
                        {workflowApplied ? 1 : 0}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Active workflow
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex justify-center gap-3 flex-wrap">
                  {createdIdeaId && (
                    <Button
                      className="gap-2"
                      size="lg"
                      onClick={handleFinishToBoard}
                    >
                      Go to your board
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant={createdIdeaId ? "outline" : "default"}
                    className="gap-2"
                    size="lg"
                    onClick={handleFinishToDashboard}
                  >
                    Go to dashboard
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Global animations */}
        <style jsx global>{`
          @keyframes checkPop {
            0% {
              transform: scale(0) rotate(-10deg);
            }
            60% {
              transform: scale(1.1) rotate(2deg);
            }
            100% {
              transform: scale(1) rotate(0);
            }
          }
        `}</style>
      </DialogContent>
    </Dialog>

    {canUseAi && (
      <CreateEnhanceDialog
        open={enhanceDialogOpen}
        onOpenChange={setEnhanceDialogOpen}
        title={ideaTitle}
        description={ideaDescription}
        kitType={selectedKit && !isCustomKit ? selectedKit.name : undefined}
        bots={bots}
        onApply={handleApplyEnhanced}
        onCreditUsed={() => {
          if (!hasByokKey) setCreditsRemaining((prev) => Math.max(0, prev - 1));
        }}
      />
    )}
    </>
  );
}
