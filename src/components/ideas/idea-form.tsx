"use client";

import { useState, useRef, useCallback, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Github, Sparkles, Undo2, Check } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { TagInput } from "./tag-input";
import { CreateEnhanceDialog } from "./create-enhance-dialog";
import { VisibilitySelector } from "./visibility-selector";
import { createIdea } from "@/actions/ideas";
import { ProjectTypeSelector } from "@/components/kits/project-type-selector";
import { KitPreview } from "@/components/kits/kit-preview";
import type { KitWithSteps } from "@/actions/kits";

interface SimpleBotProfile {
  id: string;
  full_name: string | null;
  role: string | null;
  system_prompt: string | null;
  is_active: boolean;
}

interface IdeaFormProps {
  githubUsername?: string | null;
  userId?: string;
  kits?: KitWithSteps[];
  canUseAi?: boolean;
  hasByokKey?: boolean;
  starterCredits?: number;
  bots?: SimpleBotProfile[];
}

function SubmitButton({ hasKit, kitName, pending }: { hasKit: boolean; kitName?: string; pending: boolean }) {
  return (
    <Button type="submit" size="lg" className="flex-1" disabled={pending}>
      {pending
        ? hasKit
          ? `Applying ${kitName ?? ""} kit...`
          : "Creating..."
        : hasKit
          ? "Create idea & apply kit"
          : "Create idea"}
    </Button>
  );
}

function DescriptionField({
  description,
  setDescription,
  enhanced,
  setEnhanced,
  canUseAi,
  hasByokKey,
  creditsRemaining,
  onEnhance,
  onUndo,
}: {
  description: string;
  setDescription: (v: string) => void;
  enhanced: boolean;
  setEnhanced: (v: boolean) => void;
  canUseAi: boolean;
  hasByokKey: boolean;
  creditsRemaining: number;
  onEnhance: () => void;
  onUndo: () => void;
}) {
  const [showPulse, setShowPulse] = useState(false);

  // State-aware label so it says what will actually happen:
  //  - already enhanced → "Refine" (run it again on the result)
  //  - sparse box (one-liner) → "Draft with AI" (we're generating, not polishing)
  //  - has real content → "Expand with AI" (fill out what's there)
  const enhanceLabel = enhanced
    ? "Refine"
    : description.trim().length < 80
      ? "Draft with AI"
      : "Expand with AI";

  const handleFocus = useCallback(() => {
    if (canUseAi && !enhanced) {
      setShowPulse(true);
    }
  }, [canUseAi, enhanced]);

  useEffect(() => {
    if (!showPulse) return;
    const timer = setTimeout(() => setShowPulse(false), 3000);
    return () => clearTimeout(timer);
  }, [showPulse]);

  return (
    <div className="space-y-2">
      <label htmlFor="description" className="text-sm font-medium flex items-center gap-1.5">
        Description
        {enhanced && (
          <span className="inline-flex items-center gap-1 rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-500">
            <Check className="h-2.5 w-2.5" />
            AI enhanced
          </span>
        )}
      </label>
      <div
        className={`overflow-hidden rounded-md border transition-colors ${
          enhanced
            ? "border-violet-500/25 bg-violet-500/[0.03]"
            : "border-border"
        } focus-within:border-violet-500`}
      >
        <Textarea
          id="description"
          name="description"
          placeholder="Describe your idea in detail. What problem does it solve? What tech stack would you use?"
          required
          rows={enhanced ? 10 : 6}
          value={description}
          onChange={(e) => { setDescription(e.target.value); if (enhanced) setEnhanced(false); }}
          onFocus={handleFocus}
          className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        {/* Toolbar */}
        <div className="flex items-center justify-between border-t border-border bg-muted/20 px-3 py-1.5">
          <span className="text-[11px] text-muted-foreground/60">Supports markdown</span>
          {canUseAi && (
            <button
              type="button"
              onClick={onEnhance}
              title="Expand your rough notes into a polished description — free!"
              className={`group inline-flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-gradient-to-r from-violet-500/[0.12] to-purple-500/[0.06] px-2.5 py-1 text-[13px] font-semibold text-violet-400 transition-all hover:border-violet-500/50 hover:from-violet-500/[0.2] hover:to-purple-500/[0.12] ${
                showPulse ? "animate-[enhance-pulse_0.8s_ease-in-out_4]" : ""
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {enhanceLabel}
              {!hasByokKey && creditsRemaining > 0 && (
                <span className="flex h-[1.1rem] w-[1.1rem] items-center justify-center rounded-full bg-violet-600 text-[0.6rem] font-bold leading-none text-white">
                  {creditsRemaining}
                </span>
              )}
            </button>
          )}
        </div>
      </div>
      {enhanced && (
        <button
          type="button"
          onClick={onUndo}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Undo2 className="h-3 w-3" />
          Undo — restore original
        </button>
      )}
    </div>
  );
}

export function IdeaForm({ githubUsername, userId, kits, canUseAi = false, hasByokKey = false, starterCredits = 0, bots = [] }: IdeaFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tags, setTags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  // Pre-select the Web kit so every new idea starts with a ready team +
  // workflows + labels (the empty-board default was the weakest first run).
  // Visible, not silent — the preview panel shows what's selected, and Custom
  // remains the explicit opt-out. Match by name, fall back to the first
  // non-Custom kit by display order.
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

  // AI Enhance state
  const [description, setDescription] = useState("");
  const [title, setTitle] = useState("");
  const [enhanced, setEnhanced] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState(starterCredits);
  const originalDescRef = useRef("");
  const actionsRef = useRef<HTMLDivElement>(null);
  const [enhanceDialogOpen, setEnhanceDialogOpen] = useState(false);

  const posthog = usePostHog();
  // The kit we pre-selected at mount — the baseline for "did they ship our
  // default untouched?" (was_default). Captured once so the fallback kit still
  // counts correctly if the Web kit is ever renamed/removed.
  const defaultKitIdRef = useRef(selectedKitId);
  const kitName = useCallback(
    (id: string | null) => kits?.find((k) => k.id === id)?.name ?? "none",
    [kits]
  );

  // Denominator: every form view + what we defaulted the user to. Fire once.
  useEffect(() => {
    posthog?.capture("idea_form_opened", {
      default_kit: kitName(defaultKitIdRef.current),
      kit_count: kits?.length ?? 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Genuine user override of the pre-selection — the signal that decides
  // whether Web is the right default. NEVER fired for the programmatic initial
  // set, only from the selector's onSelect.
  const handleKitSelect = useCallback(
    (id: string | null) => {
      if (id !== selectedKitId) {
        const to = kitName(id);
        posthog?.capture("idea_kit_changed", {
          from_kit: kitName(selectedKitId),
          to_kit: to,
          changed_to_custom: to === "Custom",
          from_default: selectedKitId === defaultKitIdRef.current,
        });
      }
      setSelectedKitId(id);
    },
    [selectedKitId, kitName, posthog]
  );

  // isCompactPreview removed — KitPreview no longer has compact mode
  const selectedKit = kits?.find((k) => k.id === selectedKitId) ?? null;
  const isCustomKit = selectedKit?.name === "Custom";
  const hasKit = !!selectedKitId && !isCustomKit;

  const handleEnhance = useCallback(() => {
    if (!title.trim()) {
      toast.error("Add a title first so AI knows what to enhance");
      return;
    }
    originalDescRef.current = description;
    setEnhanceDialogOpen(true);
  }, [title, description]);

  const handleApplyEnhanced = useCallback((text: string) => {
    setDescription(text);
    setEnhanced(true);
    if (!hasByokKey) setCreditsRemaining((prev) => Math.max(0, prev - 1));
    // The enhanced text lands below the fold; without this the page stays
    // scrolled at the top and it looks like nothing happened. Scroll all the
    // way down to the action row so the enhanced description and the Create
    // button are both in view. Must wait until AFTER the dialog has finished
    // its exit animation and unmounted — Radix locks body scroll (overflow
    // hidden) until then, and scrollIntoView is a no-op while it's locked.
    setTimeout(() => {
      actionsRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 400);
  }, [hasByokKey]);

  const handleUndo = useCallback(() => {
    setDescription(originalDescRef.current);
    setEnhanced(false);
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const githubUrl = (e.currentTarget.elements.namedItem("github_url") as HTMLInputElement)?.value || null;
    startTransition(async () => {
      try {
        const result = await createIdea({
          title,
          description,
          tags: tags.join(","),
          githubUrl,
          visibility,
          kitId: hasKit ? selectedKitId : null,
        });

        // Outcome event: what kit shipped, whether it was our untouched
        // default, and whether AI enhance was used. Numerator for the
        // default-ship and empty-board rates.
        posthog?.capture("idea_created", {
          kit: hasKit ? kitName(selectedKitId) : "none",
          was_default: hasKit && selectedKitId === defaultKitIdRef.current,
          enhanced,
        });

        if (result.kitError) {
          toast.error("Idea created but kit application failed — you can apply it later from the board.");
        }

        if (result.kitResult) {
          const parts: string[] = [];
          if (result.kitResult.agentsCreated > 0) parts.push(`${result.kitResult.agentsCreated} agent${result.kitResult.agentsCreated !== 1 ? "s" : ""}`);
          if (result.kitResult.labelsCreated > 0) parts.push(`${result.kitResult.labelsCreated} label${result.kitResult.labelsCreated !== 1 ? "s" : ""}`);
          const tplCount = result.kitResult.templatesImported ?? (result.kitResult.templateImported ? 1 : 0);
          const trgCount = result.kitResult.triggersCreated ?? (result.kitResult.autoRuleCreated ? 1 : 0);
          if (tplCount > 0) parts.push(`${tplCount} workflow${tplCount !== 1 ? "s" : ""}`);
          if (trgCount > 0) parts.push(`${trgCount} trigger${trgCount !== 1 ? "s" : ""}`);
          const summary = encodeURIComponent(parts.join(", ") || "applied");
          router.push(`/ideas/${result.ideaId}/board?kit_applied=${summary}`);
        } else {
          router.push(`/ideas/${result.ideaId}`);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create idea");
      }
    });
  }, [title, description, tags, visibility, hasKit, selectedKitId, enhanced, kitName, posthog, router, startTransition]);

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Share Your Idea</CardTitle>
        <CardDescription>
          Describe your vibe coding project idea and find collaborators
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="title" className="text-sm font-medium">
              Title
            </label>
            <Input
              id="title"
              name="title"
              placeholder="A catchy title for your idea"
              required
              maxLength={200}
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Project Type Selector — above description so AI enhance has kit context */}
          {kits && kits.length > 0 && (
            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium">
                  What kind of project is this?
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  This sets up the right workflow, agents, and board labels for
                  you. You can customise everything later.
                </p>
              </div>
              <ProjectTypeSelector
                kits={kits}
                selectedKitId={selectedKitId}
                onSelect={handleKitSelect}
              />
              {selectedKit && !isCustomKit && (
                <KitPreview kit={selectedKit} />
              )}
            </div>
          )}

          <DescriptionField
            description={description}
            setDescription={setDescription}
            enhanced={enhanced}
            setEnhanced={setEnhanced}
            canUseAi={canUseAi}
            hasByokKey={hasByokKey}
            creditsRemaining={creditsRemaining}
            onEnhance={handleEnhance}
            onUndo={handleUndo}
          />

          <div className="space-y-2">
            <label className="text-sm font-medium">Tags</label>
            <TagInput value={tags} onChange={setTags} />
          </div>

          <div className="space-y-2">
            <label htmlFor="github_url" className="text-sm font-medium">
              GitHub URL (optional)
            </label>
            <Input
              id="github_url"
              name="github_url"
              type="url"
              placeholder={githubUsername ? `https://github.com/${githubUsername}/repo` : "https://github.com/username/repo"}
            />
            {!githubUsername && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Github className="h-3 w-3" />
                <Link href={userId ? `/profile/${userId}` : "/profile"} className="text-primary hover:underline">
                  Connect your GitHub
                </Link>{" "}
                to auto-fill repository URLs
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Visibility</label>
            <VisibilitySelector value={visibility} onChange={setVisibility} />
          </div>

          <div ref={actionsRef} className="flex scroll-mb-4 gap-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="flex-1"
              onClick={() => router.back()}
            >
              Cancel
            </Button>
            <SubmitButton hasKit={hasKit} kitName={selectedKit?.name} pending={isPending} />
          </div>
        </form>
      </CardContent>
      {canUseAi && (
        <CreateEnhanceDialog
          open={enhanceDialogOpen}
          onOpenChange={setEnhanceDialogOpen}
          title={title}
          description={description}
          kitType={selectedKit && !isCustomKit ? selectedKit.name : undefined}
          bots={bots}
          onApply={handleApplyEnhanced}
          onCreditUsed={() => {
            if (!hasByokKey) setCreditsRemaining((prev) => Math.max(0, prev - 1));
          }}
        />
      )}
    </Card>
  );
}
