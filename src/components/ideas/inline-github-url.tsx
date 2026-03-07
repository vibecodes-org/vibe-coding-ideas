"use client";

import { useState, useRef } from "react";
import { Github, ExternalLink, Pencil, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { updateIdeaFields } from "@/actions/ideas";

interface InlineGithubUrlProps {
  ideaId: string;
  githubUrl: string | null;
  isAuthor: boolean;
}

export function InlineGithubUrl({
  ideaId,
  githubUrl: initialGithubUrl,
  isAuthor,
}: InlineGithubUrlProps) {
  const [githubUrl, setGithubUrl] = useState(initialGithubUrl ?? "");
  const [editing, setEditing] = useState(false);
  const previousRef = useRef(initialGithubUrl ?? "");

  async function handleBlur() {
    setEditing(false);
    const trimmed = githubUrl.trim();
    if (trimmed === previousRef.current) return;
    try {
      await updateIdeaFields(ideaId, { github_url: trimmed || null });
      previousRef.current = trimmed;
    } catch {
      toast.error("Failed to update GitHub URL");
      setGithubUrl(previousRef.current);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      setGithubUrl(previousRef.current);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <Input
        value={githubUrl}
        onChange={(e) => setGithubUrl(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder="https://github.com/..."
        autoFocus
        className="h-7 max-w-[260px] text-xs"
      />
    );
  }

  if (isAuthor) {
    if (githubUrl) {
      return (
        <div className="group/github flex items-center gap-1">
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Github className="h-3.5 w-3.5" />
            Repository
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
          <button
            onClick={() => setEditing(true)}
            className="text-muted-foreground opacity-0 group-hover/github:opacity-100 transition-opacity hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
          </button>
        </div>
      );
    }

    return (
      <button
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Github className="h-3.5 w-3.5" />
        <Plus className="h-3 w-3" />
      </button>
    );
  }

  if (!initialGithubUrl) return null;

  return (
    <a
      href={initialGithubUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      <Github className="h-3.5 w-3.5" />
      Repository
      <ExternalLink className="h-2.5 w-2.5" />
    </a>
  );
}
