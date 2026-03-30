"use client";

import { useState, useRef, useCallback, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { Switch } from "@/components/ui/switch";
import { Github, Lock, Sparkles, Undo2, Check } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { TagInput } from "./tag-input";
import { CreateEnhanceDialog } from "./create-enhance-dialog";
import { createIdea } from "@/actions/ideas";
import { ProjectTypeSelector } from "@/components/kits/project-type-selector";
import { KitPreview } from "@/components/kits/kit-preview";
import { useMediaQuery } from "@/hooks/use-media-query";
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
              {enhanced ? "Re-enhance" : "Enhance with AI"}
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
  const [isPrivate, setIsPrivate] = useState(false);
  const [selectedKitId, setSelectedKitId] = useState<string | null>(null);

  // AI Enhance state
  const [description, setDescription] = useState("");
  const [title, setTitle] = useState("");
  const [enhanced, setEnhanced] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState(starterCredits);
  const originalDescRef = useRef("");
  const [enhanceDialogOpen, setEnhanceDialogOpen] = useState(false);

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
          visibility: isPrivate ? "private" : "public",
          kitId: hasKit ? selectedKitId : null,
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
  }, [title, description, tags, isPrivate, hasKit, selectedKitId, router, startTransition]);

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
                onSelect={setSelectedKitId}
              />
              {selectedKit && !isCustomKit && (
                <KitPreview
                  kit={selectedKit}
                  selectedIndex={[...kits].sort((a, b) => {
                    if (a.name === "Custom") return 1;
                    if (b.name === "Custom") return -1;
                    return a.display_order - b.display_order;
                  }).findIndex((k) => k.id === selectedKitId)}
                  columnCount={3}
                />
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

          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <Lock className="h-4 w-4 text-muted-foreground" />
              <div className="space-y-0.5">
                <label htmlFor="private-toggle" className="text-sm font-medium">
                  Private idea
                </label>
                <p className="text-xs text-muted-foreground">
                  Only you and collaborators can see this idea
                </p>
              </div>
            </div>
            <Switch
              id="private-toggle"
              checked={isPrivate}
              onCheckedChange={setIsPrivate}
            />
          </div>

          <div className="flex gap-3">
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
