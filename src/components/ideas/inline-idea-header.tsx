"use client";

import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { updateIdeaFields } from "@/actions/ideas";

interface InlineIdeaHeaderProps {
  ideaId: string;
  title: string;
  isAuthor: boolean;
}

export function InlineIdeaHeader({
  ideaId,
  title: initialTitle,
  isAuthor,
}: InlineIdeaHeaderProps) {
  const [title, setTitle] = useState(initialTitle);
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

  if (!isAuthor) {
    return (
      <h1 className="text-3xl font-bold tracking-tight break-words">
        {initialTitle}
      </h1>
    );
  }

  return (
    <Input
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={handleTitleBlur}
      onKeyDown={handleTitleKeyDown}
      className="border-none bg-transparent dark:bg-transparent px-0 pt-0 pb-0 text-3xl md:text-3xl font-bold tracking-tight shadow-none focus-visible:ring-0 hover:underline hover:decoration-muted-foreground/30 hover:underline-offset-4 h-auto leading-snug min-w-0 flex-1"
    />
  );
}
