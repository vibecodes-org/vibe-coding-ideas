"use client";

import { useState, useRef, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
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
      <div className="mt-4 flex flex-wrap gap-2">
        {initialTags.map((tag) => (
          <Badge key={tag} variant="secondary">
            {tag}
          </Badge>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-4">
      <TagInput value={tags} onChange={handleTagsChange} />
    </div>
  );
}
