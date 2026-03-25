"use client";

import { useState, useRef, useCallback } from "react";
import { useFormStatus } from "react-dom";
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
import { Github, Lock, Sparkles, Loader2, Undo2, Check } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { TagInput } from "./tag-input";
import { createIdea } from "@/actions/ideas";
import { enhanceCreateDescription } from "@/actions/ai";
import { ProjectTypeSelector } from "@/components/kits/project-type-selector";
import { KitPreview } from "@/components/kits/kit-preview";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { KitWithSteps } from "@/actions/kits";

interface IdeaFormProps {
  githubUsername?: string | null;
  userId?: string;
  kits?: KitWithSteps[];
  canUseAi?: boolean;
  hasByokKey?: boolean;
  starterCredits?: number;
}

function SubmitButton({ hasKit, kitName }: { hasKit: boolean; kitName?: string }) {
  const { pending } = useFormStatus();
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

export function IdeaForm({ githubUsername, userId, kits, canUseAi = false, hasByokKey = false, starterCredits = 0 }: IdeaFormProps) {
  const router = useRouter();
  const [tags, setTags] = useState<string[]>([]);
  const [isPrivate, setIsPrivate] = useState(false);
  const [selectedKitId, setSelectedKitId] = useState<string | null>(null);

  // AI Enhance state
  const [description, setDescription] = useState("");
  const [title, setTitle] = useState("");
  const [enhancing, setEnhancing] = useState(false);
  const [enhanced, setEnhanced] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState(starterCredits);
  const originalDescRef = useRef<string>("");

  const isCompactPreview = useMediaQuery("(max-width: 479px)");
  const selectedKit = kits?.find((k) => k.id === selectedKitId) ?? null;
  const isCustomKit = selectedKit?.name === "Custom";
  const hasKit = !!selectedKitId && !isCustomKit;

  const handleEnhance = useCallback(async () => {
    if (enhancing) return;
    if (!title.trim()) {
      toast.error("Add a title first so AI knows what to enhance");
      return;
    }
    setEnhancing(true);
    originalDescRef.current = description;
    try {
      const { enhanced: text } = await enhanceCreateDescription({
        title: title.trim(),
        description: description.trim(),
        kitType: selectedKit && !isCustomKit ? selectedKit.name : undefined,
      });
      setDescription(text);
      setEnhanced(true);
      if (!hasByokKey) setCreditsRemaining((prev) => Math.max(0, prev - 1));
      toast.success("Description enhanced with AI");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to enhance description");
    } finally {
      setEnhancing(false);
    }
  }, [enhancing, title, description, selectedKit, isCustomKit, hasByokKey]);

  const handleUndo = useCallback(() => {
    setDescription(originalDescRef.current);
    setEnhanced(false);
  }, []);

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Share Your Idea</CardTitle>
        <CardDescription>
          Describe your vibe coding project idea and find collaborators
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={createIdea} className="space-y-6">
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
                <KitPreview kit={selectedKit} compact={isCompactPreview} />
              )}
              <input
                type="hidden"
                name="kit_id"
                value={hasKit ? selectedKitId! : ""}
              />
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="description" className="text-sm font-medium flex items-center gap-1.5">
                Description
                {enhanced && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-500">
                    <Check className="h-2.5 w-2.5" />
                    AI enhanced
                  </span>
                )}
              </label>
              {canUseAi && (
                <button
                  type="button"
                  onClick={handleEnhance}
                  disabled={enhancing}
                  className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/30 px-2.5 py-1 text-xs font-medium text-violet-400 transition-colors hover:border-violet-500/50 hover:bg-violet-500/10 disabled:pointer-events-none disabled:opacity-50"
                >
                  {enhancing ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Enhancing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3 w-3" />
                      {enhanced ? "Re-enhance" : "Enhance with AI"}
                      {!hasByokKey && creditsRemaining > 0 && (
                        <span className="rounded-full bg-violet-600 px-1.5 text-[10px] font-semibold leading-4 text-white">
                          {creditsRemaining}
                        </span>
                      )}
                    </>
                  )}
                </button>
              )}
            </div>
            <div className="relative">
              <Textarea
                id="description"
                name="description"
                placeholder="Describe your idea in detail. What problem does it solve? What tech stack would you use?"
                required
                rows={enhanced ? 10 : 6}
                value={description}
                onChange={(e) => { setDescription(e.target.value); if (enhanced) setEnhanced(false); }}
                disabled={enhancing}
                className={enhanced ? "border-violet-500/25 bg-violet-500/[0.03]" : ""}
              />
              {enhancing && (
                <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
                  <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-violet-500/[0.06] to-transparent" />
                </div>
              )}
            </div>
            {enhancing && (
              <p className="text-xs text-violet-400">
                {selectedKit && !isCustomKit
                  ? `Tailoring for ${selectedKit.name} project...`
                  : "Enhancing your description..."}
              </p>
            )}
            {enhanced && !enhancing && (
              <button
                type="button"
                onClick={handleUndo}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Undo2 className="h-3 w-3" />
                Undo — restore original
              </button>
            )}
          </div>

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
            <input type="hidden" name="visibility" value={isPrivate ? "private" : "public"} />
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
            <SubmitButton hasKit={hasKit} kitName={selectedKit?.name} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
