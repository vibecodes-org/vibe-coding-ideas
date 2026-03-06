"use client";

import { useState, useRef } from "react";
import { Lock, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { updateIdeaFields } from "@/actions/ideas";

interface InlineIdeaHeaderProps {
  ideaId: string;
  title: string;
  visibility: "public" | "private";
  isAuthor: boolean;
}

export function InlineIdeaHeader({
  ideaId,
  title: initialTitle,
  visibility: initialVisibility,
  isAuthor,
}: InlineIdeaHeaderProps) {
  const [title, setTitle] = useState(initialTitle);
  const [visibility, setVisibility] = useState(initialVisibility);
  const previousTitleRef = useRef(initialTitle);
  const escapePressedRef = useRef(false);

  async function handleTitleBlur() {
    if (escapePressedRef.current) {
      escapePressedRef.current = false;
      setTitle(previousTitleRef.current);
      return;
    }
    const trimmed = title.trim();
    if (!trimmed || trimmed === previousTitleRef.current) {
      setTitle(previousTitleRef.current);
      return;
    }
    try {
      await updateIdeaFields(ideaId, { title: trimmed });
      previousTitleRef.current = trimmed;
    } catch {
      toast.error("Failed to update title");
      setTitle(previousTitleRef.current);
    }
  }

  function handleTitleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      escapePressedRef.current = true;
      (e.target as HTMLInputElement).blur();
    }
  }

  async function handleVisibilityToggle() {
    const next = visibility === "public" ? "private" : "public";
    setVisibility(next);
    try {
      await updateIdeaFields(ideaId, { visibility: next });
    } catch {
      toast.error("Failed to update visibility");
      setVisibility(visibility);
    }
  }

  if (!isAuthor) {
    return (
      <div className="flex items-center gap-2">
        <h1 className="text-3xl font-bold tracking-tight min-w-0 break-words">{initialTitle}</h1>
        {initialVisibility === "private" && (
          <Badge variant="outline" className="gap-1">
            <Lock className="h-3 w-3" />
            Private
          </Badge>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={handleTitleBlur}
        onKeyDown={handleTitleKeyDown}
        className="border-none bg-transparent dark:bg-transparent px-0 py-2 text-3xl md:text-3xl font-bold tracking-tight shadow-none focus-visible:ring-0 hover:underline hover:decoration-muted-foreground/30 hover:underline-offset-4 h-auto leading-snug min-w-0"
      />
      <Badge
        variant="outline"
        className="gap-1 cursor-pointer shrink-0 hover:bg-accent transition-colors"
        onClick={handleVisibilityToggle}
      >
        {visibility === "private" ? (
          <>
            <Lock className="h-3 w-3" />
            Private
          </>
        ) : (
          <>
            <Globe className="h-3 w-3" />
            Public
          </>
        )}
      </Badge>
    </div>
  );
}
