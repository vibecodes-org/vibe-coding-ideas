"use client";

import { useState, useRef, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TagInput } from "./tag-input";
import { toast } from "sonner";
import { updateIdeaFields } from "@/actions/ideas";

interface InlineIdeaTagsProps {
  ideaId: string;
  tags: string[];
  isAuthor: boolean;
}

export function InlineIdeaTags({
  ideaId,
  tags: initialTags,
  isAuthor,
}: InlineIdeaTagsProps) {
  const [tags, setTags] = useState(initialTags);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousTagsRef = useRef(initialTags);

  const handleTagsChange = useCallback(
    (newTags: string[]) => {
      setTags(newTags);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          await updateIdeaFields(ideaId, { tags: newTags });
          previousTagsRef.current = newTags;
        } catch {
          toast.error("Failed to update tags");
          setTags(previousTagsRef.current);
        }
      }, 300);
    },
    [ideaId]
  );

  if (!isAuthor) {
    if (initialTags.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1.5">
        {initialTags.map((tag) => (
          <Badge key={tag} variant="secondary" className="text-xs">
            {tag}
          </Badge>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary" className="text-xs">
          {tag}
        </Badge>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <button className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary">
            +
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3" align="start">
          <TagInput value={tags} onChange={handleTagsChange} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
