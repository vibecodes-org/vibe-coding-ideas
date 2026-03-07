"use client";

import { useState, useRef, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/ui/markdown";
import { toast } from "sonner";
import { updateIdeaFields } from "@/actions/ideas";

interface InlineIdeaBodyProps {
  ideaId: string;
  description: string;
  isAuthor: boolean;
}

export function InlineIdeaBody({
  ideaId,
  description: initialDescription,
  isAuthor,
}: InlineIdeaBodyProps) {
  const [description, setDescription] = useState(initialDescription);
  const [editingDescription, setEditingDescription] = useState(false);
  const previousDescRef = useRef(initialDescription);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync local state when the server prop changes (e.g. after AI enhance + router.refresh)
  useEffect(() => {
    if (!editingDescription) {
      setDescription(initialDescription);
      previousDescRef.current = initialDescription;
    }
  }, [initialDescription, editingDescription]);

  function startEditingDescription() {
    if (!isAuthor) return;
    setEditingDescription(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function handleDescriptionBlur() {
    setEditingDescription(false);
    const trimmed = description.trim();
    if (trimmed === previousDescRef.current) return;
    if (!trimmed) {
      setDescription(previousDescRef.current);
      return;
    }
    try {
      await updateIdeaFields(ideaId, { description: trimmed });
      previousDescRef.current = trimmed;
    } catch {
      toast.error("Failed to update description");
      setDescription(previousDescRef.current);
    }
  }

  function handleDescriptionKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setDescription(previousDescRef.current);
      setEditingDescription(false);
    }
  }

  return isAuthor ? (
    editingDescription ? (
      <div className="text-foreground/90 leading-relaxed">
        <Textarea
          ref={textareaRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={handleDescriptionBlur}
          onKeyDown={handleDescriptionKeyDown}
          rows={12}
          className="min-h-[200px] resize-y"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Supports Markdown. Press Escape to cancel.
        </p>
      </div>
    ) : (
      <div
        onClick={startEditingDescription}
        className="text-foreground/90 leading-relaxed cursor-text rounded-md border border-transparent px-2 py-1 -mx-2 -my-1 transition-colors hover:border-border hover:bg-muted/30"
      >
        <Markdown>{description}</Markdown>
      </div>
    )
  ) : (
    <div className="text-foreground/90 leading-relaxed">
      <Markdown>{initialDescription}</Markdown>
    </div>
  );
}
